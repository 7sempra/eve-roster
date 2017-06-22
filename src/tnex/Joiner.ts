import Knex = require('knex');
import Promise = require('bluebird');

import { Comparison, Link, ValueWrapper } from './core';
import { Scoper } from './Scoper';
import { Query } from './Query';
import { RenamedJoin } from './RenamedJoin';
import { assertHasValue } from '../util/assert';


export type Nullable<T>  = {
  [P in keyof T]: T[P] | null
};

interface ColumnSelect {
  column: string,
  alias?: string,
}

/**
 * Class that represents a SELECT query in SQL. As the name of the class
 * suggests, the tricky part of such statements are the joins. A Joiner keeps
 * track of two sets of columns: J, the set of "joined columns", i.e. all off
 * the columns contained in the original table plus all joined tables, and S,
 * the set of all "selected columns", i.e. all columns in J that have been
 * selected via calls to columns(), columnAs(), or aggregator functions like
 * sum(). In other words, J determines what columns _may_ be selected, while
 * S determines what columns _have_ been selected.
 * 
 * Because of the design of Joiner, calls to methods that select columns
 * usually occur at the _end_ of a chain of calls, not at the beginning as is
 * traditionally the case in SQL select statements.
 */
export class Joiner<J extends object /* joined */, S /* selected */>
    extends Query<J, S[]> {
  private _subqueryTableName: string | undefined;

  private _selectedColumns = [] as ColumnSelect[];
  private _pendingSelectedColumns = [] as  ColumnSelect[];

  constructor(
      knex: Knex,
      scoper: Scoper,
      table: J,
      subqueryTableName?: string,
      ) {
    super(
        scoper.mirror(),
        knex(scoper.getTableName(table)),
        subqueryTableName == undefined);
    this._subqueryTableName = subqueryTableName;
  }

  public run(): Promise<S[]> {
    if (this._subqueryTableName != null) {
      throw new Error(`Subqueries can't be run().`);
    }
    this._query = this._query.select(this._getPendingColumnSelectStatements());

    return super.run();
  }

  public fetchFirst(): Promise<S | null> {
    return this.run()
    .then(rows => {
      return rows[0];
    });
  }

  public columns<K extends keyof J>(...columns: K[])
      : Joiner<J, S & Pick<J, K>> {
    if (this._subqueryTableName != null) {
      throw new Error(
          `Subqueries don't support columns(). Use columnAs() instead.`);
    }

    for (let column of columns) {
      this._pendingSelectedColumns.push({ column })
    }

    return this as any;
  }

  /**
   * Select a column and give it a new name in the result row.
   * 
   * IMPORTANT: If this is a subquery, `alias` must by scoped with the
   * subquery's table name. For example:
   * 
   * tnex.subquery('foo', myTable).columnAs('myTable_id', 'foo_id')
   * 
   * @param column The column to select.
   * @param alias The desired name of the column in the result set.
   */
  public columnAs<K extends keyof J, L extends string>(column: K, alias: L)
      : Joiner<J, S & Link<J, K, L>> {
    this._pendingSelectedColumns.push({ column, alias });

    return this as any;
  }


  /*
   * Join methods
   */

  
  // Normal join
  public join<T extends object>(
      table: T,
      left: keyof T,
      cmp: Comparison,
      right: keyof J,
  ): Joiner<J & T, S>;
  // Subjoin
  public join<T extends object, E>(
      subselect: Joiner<T, E>,
      left: keyof E,
      cmp: Comparison,
      right: keyof J,
      ): Joiner<J & E, S>;
  // Renamed join
  public join<T extends object, E>(
      renamedTable: RenamedJoin<T, E>,
      left: keyof E,
      cmp: Comparison,
      right: keyof J,
      ): Joiner<J & E, S>;
  // Implementation
  public join(
      table: object,
      left: string,
      cmp: Comparison,
      right: string,
  ) {
    let joinTarget: string | Knex.QueryBuilder;

    let requiredPrefix: string | undefined;
    if (table instanceof Joiner) {
      joinTarget = this._processSubJoin(table);
      requiredPrefix = assertHasValue(table._subqueryTableName);
      this._scoper.registerSyntheticPrefix(requiredPrefix);
    } else if (table instanceof RenamedJoin) {
      joinTarget = this._processRenamedJoin(table);
    } else {
      joinTarget = this._processJoin(table);
    }

    this._query = this._query.join(
          joinTarget,
          this._scoper.scopeColumn(left, requiredPrefix),
          cmp,
          this._scoper.scopeColumn(right));

    return this;
  }

  // Normal
  public leftJoin<T extends object>(
      table: T,
      left: keyof T,
      cmp: Comparison,
      right: keyof J,
      ): Joiner<J & Nullable<T>, S>;
  // Subselect
  public leftJoin<T extends object, E>(
      sub: Joiner<T, E>,
      left: keyof E,
      cmp: Comparison,
      right: keyof J,
      ): Joiner<J & Nullable<E>, S>;
  // Renamed join
  public leftJoin<T extends object, E>(
      join: RenamedJoin<T, E>,
      left: keyof E,
      cmp: Comparison,
      right: keyof J,
      ): Joiner<J & Nullable<E>, S>;
  // Implementation
  public leftJoin(
      table: object,
      left: string,
      cmp: Comparison,
      right: string,
      ) {

    let joinTarget: string | Knex.QueryBuilder;
    let requiredPrefix: string | undefined;
    
    if (table instanceof Joiner) {
      joinTarget = this._processSubJoin(table);
      requiredPrefix = assertHasValue(table._subqueryTableName);
      this._scoper.registerSyntheticPrefix(requiredPrefix);
    } else if (table instanceof RenamedJoin) {
      this._scoper.registerSyntheticPrefix(table.tableAlias);
      joinTarget = this._processRenamedJoin(table);
    } else {
      joinTarget = this._processJoin(table);
    }

    this._query = this._query.leftJoin(
          joinTarget,
          this._scoper.scopeColumn(left),
          cmp,
          this._scoper.scopeColumn(right));

    return this;
  }

  private _processJoin<T extends object>(table: T) {
    return this._scoper.getTableName(table);
  }

  private _processSubJoin<T extends object, E>(sub: Joiner<T, E>) {
    if (sub._subqueryTableName == null) {
      throw new Error(
          `Query is not a subquery. Use subselect() instead of select()`);
    }

    let subquery = sub._query;
    if (sub._pendingSelectedColumns.length > 0) {
      subquery = subquery.select(sub._getPendingColumnSelectStatements());
    }
    return subquery.as(sub._subqueryTableName);
  }

  private _processRenamedJoin<T extends object, E>(join: RenamedJoin<T, E>) {
    // We don't need to check that the prefixes match -- that's already
    // been checked in RenamedJoin.using()
    return `${this._scoper.getTableName(join.table)} as ${join.tableAlias}`;
  }

  /*
   * Aggregate methods
   * 
   * Not comprehensive. Add as necessary.
   */

  public sum<K extends keyof J, L extends string>(
      column: K,
      alias: L,
      ): Joiner<J, S & Link<J, K, L>> {

    this._query = this._query.sum(this._prepForSelect(column, alias));
    return this as any;
  }

  public count<K extends keyof J, L extends string>(
      column: K,
      alias: L,
      ): Joiner<J, S & Link<J, K, L>> {

    // TODO: Flag that this might need to be converted from a string to a
    // number. 
    this._query = this._query.count(this._prepForSelect(column, alias));
    return this as any;
  }

  public max<K extends keyof J, L extends string>(
      column: K,
      alias: L,
      ): Joiner<J, S & Link<J, K, L>> {

    this._query = this._query.max(this._prepForSelect(column, alias));
    return this as any;
  }


  /*
   * Misc methods
   */

  public groupBy(column: keyof J): this {
    this._query = this._query.groupBy(this._scoper.scopeColumn(column));
    return this;
  }

  public distinct(column: keyof J): this {
    this._query = this._query.distinct(this._scoper.scopeColumn(column));
    return this;
  }

  public orderBy(column: keyof J, direction: 'asc' | 'desc'): this {
    this._query = this._query.orderBy(
        this._scoper.scopeColumn(column), direction);
    return this;
  }

  public limit(size: number): this {
    this._query = this._query.limit(size);
    return this;
  }


  /*
   * Helper methods
   */

  private _getPendingColumnSelectStatements() {
    return this._pendingSelectedColumns.map(cs => {
      return this._prepForSelect(cs.column, cs.alias);
    });
  }

  private _prepForSelect(prefixedColumn: string, alias?: string) {
    if (this._subqueryTableName == undefined) {
      // "character.id as character_id"
      // "character.id as foobar"
      return `${this._scoper.scopeColumn(prefixedColumn)} as`
          + ` ${alias || prefixedColumn}`;
    } else {
      if (alias == undefined) {
        throw new Error(
            `Unexpectedly undefined alias for "${prefixedColumn}".`);
      }
      let [prefix] = this._scoper.splitColumn(alias);
      if (prefix != this._subqueryTableName) {
        throw new Error(
            `Alias "${alias}" for column "${prefixedColumn}" must be`
                + ` prefixed with "${this._subqueryTableName}".`);
      }

      // local.unprefixedColumn as unprefixedAlias
      // "character.id as myId"
      return `${this._scoper.scopeColumn(prefixedColumn)} as `
          + `${this._scoper.stripPrefix(alias)}`;
    }
  }
}
