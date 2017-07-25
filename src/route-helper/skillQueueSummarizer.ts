import Promise = require('bluebird');
import moment = require('moment');

import * as time from '../util/time';
import { Tnex } from '../tnex';
import { dao } from '../dao';
import { SkillQueueEntry } from '../dao/SkillQueueDao';
import { updateSkillQueue, getTrainingProgress, isQueueEntryCompleted } from '../data-source/skillQueue';
import { isAnyEsiError } from '../util/error';

const logger = require('../util/logger')(__filename);


const STATIC = require('../static-data').get();
const SKILL_LEVEL_LABELS = ['0', 'I', 'II', 'III', 'IV', 'V'];

export type DataFreshness = 'fresh' | 'cached';
export type QueueStatus = 'empty' | 'paused' | 'active';
export type WarningType = 'bad_credentials' | 'fetch_failure';

export interface SkillQueueSummary {
  dataFreshness: DataFreshness,
  queueStatus: QueueStatus,
  skillInTraining: null | {
    name: string,
    progress: number,
    timeRemaining: string | null
  },
  queue: {
    count: number,
    timeRemaining: string | null;
  },
  warning?: WarningType,
}

/**
 * Loads a character's skill queue and then generates summary text for it
 * for use in the dashboard.
 */
export function loadSummarizedQueue(
    db: Tnex,
    characterId: number,
    freshness: DataFreshness,
    ) {
  return Promise.resolve()
  .then(() => {
    return loadQueue(db, characterId, freshness);
  })
  .then(({ queue, dataFreshness, warning }) => {
    queue = pruneCompletedSkills(queue);
    let queueStatus = getQueueStatus(queue);
    return {
      queueStatus: queueStatus,
      dataFreshness: dataFreshness,
      skillInTraining: getActiveSkillSummary(queue, queueStatus),
      queue: getQueueSummary(queue, queueStatus),
      warning: warning,
    }
  })
}

function loadQueue(db: Tnex, characterId: number, freshness: DataFreshness) {
  let dataFreshness = freshness;
  let warning = undefined as WarningType|undefined;

  return Promise.resolve()
  .then(() => {
    if (freshness == 'cached') {
      return dao.skillQueue.getCachedSkillQueue(db, characterId);
    } else {
      return updateSkillQueue(db, characterId)
      .catch(e => {
        warning = consumeOrThrowError(e, characterId);
        dataFreshness = 'cached';
        return dao.skillQueue.getCachedSkillQueue(db, characterId);
      })
    }
  })
  .then(queue => {
    return {
      queue: queue,
      dataFreshness: freshness,
      warning: warning,
    }
  });
}

function consumeOrThrowError(e: any, characterId: number): WarningType {
  let warningType: WarningType;
  if (isAnyEsiError(e)) {
    if (e.name == 'esi:ForbiddenError') {
      warningType = 'bad_credentials';
    } else {
      warningType = 'fetch_failure';
    }
    logger.error(
        `ESI error "${e.name}" while fetching skill queue for character`
            + ` ${characterId}.`);
    logger.error(e);
  } else if (e.response) {
    warningType = 'fetch_failure';

    logger.error(`Error while fetching skill queue for ${characterId}.`);
    logger.error(e);
    logger.error(e.response.status);
    logger.error(e.response.data);
  } else {
    throw e;
  }

  return warningType;
}

function pruneCompletedSkills(queueData: SkillQueueEntry[]) {
  let now = moment().valueOf();
  let i = 0;
  for (; i < queueData.length; i++) {
    let item = queueData[i];

    if (!isQueueEntryCompleted(item)) {
      break;
    }
  }
  return queueData.slice(i);
}

function getQueueStatus(queue: SkillQueueEntry[]): QueueStatus {
  if (queue.length == 0) {
    return 'empty';
  } else if (queue[0].startTime == null) {
    return 'paused';
  } else {
    return 'active';
  }
}

function getActiveSkillSummary(
    queue: SkillQueueEntry[],
    queueStatus: QueueStatus,
    ) {
  let summary = null;
  if (queue.length > 0) {
    let firstItem = queue[0];
    let skillName = STATIC.SKILLS[firstItem.skill].name;
    let skillLevelLabel = SKILL_LEVEL_LABELS[firstItem.targetLevel];

    summary = {
      name: skillName + ' ' + skillLevelLabel,
      progress: getTrainingProgress(firstItem),
      timeRemaining: queueStatus == 'active' && firstItem.endTime != null
          ? time.shortDurationString(Date.now(), firstItem.endTime, 2)
          : null,
    };
  }
  return summary;
}

function getQueueSummary(
    queue: SkillQueueEntry[],
    queueStatus: QueueStatus,
    ) {
  let finalEntry = queue[queue.length - 1];
  return {
    count: queue.length,
    timeRemaining: queueStatus == 'active' && finalEntry.endTime != null
        ? time.shortDurationString(
            Date.now(),
            finalEntry.endTime,
            2)
        : null,
  };
}
