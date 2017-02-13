const Promise = require('bluebird');

module.exports = {

  /**
   * Calls `callback(item, index)` on each item in `list`. Returns a Promise
   * wrapping all of the values returned by the callback calls.
   */
  parallelize(list, callback) {
    let work = [];

    for (let i = 0; i < list.length; i++) {
      work.push(callback(list[i], i));
    }
    return Promise.all(work);
  },

  /**
   * Calls `callback(item, index)` on each item in `list`. If `callback`
   * returns a `Promise`, waits until the promise resolves before calling
   * `callback` on the next item in the list.
   */
  serialize(list, callback) {
    let i = -1;
    let results = [];

    return new Promise(function(resolve, reject) {
      callNext();

      function callNext() {
        i++;
        if (i < list.length) {
          Promise.resolve(callback(list[i], i))
          .then(function(result) {
            results.push(result);
            callNext();
          })
          .catch(function(e) {
            reject(e);
          });
        } else {
          resolve(results);
        }
      }
    });
  },

  /**
   * Repeatedly executes `callback` until it returns `undefined` (or a Promise
   * that resolves to `undefined`). `callback` is passed the result of the
   * previous execution. If this is the first execution, `initialValue` is
   * passed instead.
   */
  doWhile(initialValue, callback) {
    return new Promise((resolve, reject) => {
      onResult(initialValue);

      function onResult(previousResult) {
        if (previousResult == undefined) {
          resolve();
        } else {
          Promise.resolve(callback(previousResult))
            .then(onResult)
            .catch(onError);
        }
      }

      function onError(e) {
        reject(e);
      }
    });
  },
};
