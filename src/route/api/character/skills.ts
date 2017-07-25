import Promise = require('bluebird');

import { jsonEndpoint } from '../../../route-helper/protectedEndpoint';
import { dao } from '../../../dao';
import { Tnex } from '../../../tnex';

import { AccountPrivileges } from '../../../route-helper/privileges';
import { isAnyEsiError } from '../../../util/error';
import { getAccessTokenForCharacter } from '../../../data-source/accessToken';
import { updateSkills } from '../../../data-source/skills';
import { getTrainingProgress, isQueueEntryCompleted } from '../../../data-source/skillQueue';
import { SkillsheetEntry } from '../../../dao/SkillsheetDao';
import { SkillQueueEntry } from '../../../dao/SkillQueueDao';
import { MissingTokenError } from '../../../error/MissingTokenError';
import esi from '../../../esi';
import * as time from '../../../util/time';

const STATIC = require('../../../static-data').get();
const logger = require('../../../util/logger')(__filename);


export interface Payload {
  skills: Array<{
    id: number,
    name: string,
    group: number,
    level: number,
    sp: number,
  }>,
  // Only present if account can read this character's skill queue
  queue?: {
    entries: QueueEntryJson[],
    completed: CompletedQueueEntryJson[],
    durationLabel: string|null,
  },
  // Only present if there was a problem when requesting the data
  warning?: string,
}

export interface QueueEntryJson {
  id: number,
  targetLevel: number,
  proportionalStart: number,
  proportionalEnd: number,
  durationLabel: string,
  progress: number,
}

export interface CompletedQueueEntryJson {
  id: number,
  completed: number,
}

export default jsonEndpoint(function(req, res, db, account, privs)
    : Promise<Payload> {
  let characterId: number = parseInt(req.params.id);
  let isOwner = false;

  return dao.character.getOwner(db, characterId)
  .then(row => {
    isOwner = account.id == (row && row.account_id);
    privs.requireRead('characterSkills', isOwner);
    return fetchData(db, characterId);
  })
  .then(({ rawSkills, rawQueue, warningMessage }) => {
    const payload = {
      skills: transformSkills(rawSkills),
      queue: undefined as Payload['queue'],
      warning: warningMessage,
    };

    if (privs.canRead('characterSkillQueue', isOwner)) {
      let { queued, completed } = transformQueue(rawQueue);
      payload.queue = {
        entries: queued,
        completed: completed,
        durationLabel: getRemainingDurationLabel(rawQueue),
      };
    }

    return payload;
  });
});

function fetchData(db: Tnex, characterId: number) {
  let warningMessage: string|undefined;

  return updateSkills(db, characterId)
  .catch(e => {
    warningMessage = consumeOrThrowError(e);
    return loadCachedData(db, characterId);
  })
  .then(({ queue, skills }) => {
    return {
      rawSkills: skills,
      rawQueue: queue,
      warningMessage: warningMessage,
    }
  })
}

function loadCachedData(db: Tnex, characterId: number) {
  return Promise.all([
    dao.skillQueue.getCachedSkillQueue(db, characterId),
    dao.skillsheet.get(db, characterId),
  ])
  .then(([queue, skills]) => {
    return {
      queue: queue,
      skills: skills,
    }
  });
}

function consumeOrThrowError(e: any) {
  if (isAnyEsiError(e)) {
    return 'ESI request failed. Skills may be out of date.';
  } else if (e instanceof MissingTokenError) {
    return 'Missing access token for this character.'
  } else {
    // Unknown failure
    throw e;
  }
}

function transformSkills(skills: SkillsheetEntry[]) {
  return skills.map(skill => ({
    id: skill.skillsheet_skill,
    name: STATIC.SKILLS[skill.skillsheet_skill].name,
    group: STATIC.SKILLS[skill.skillsheet_skill].groupId,
    level: skill.skillsheet_level,
    sp: skill.skillsheet_skillpoints,
  }));
}

function transformQueue(queue: SkillQueueEntry[]) {
  let now = Date.now();
  let totalDuration = getRemainingDuration(queue, now);

  let completedEntries = [] as CompletedQueueEntryJson[];
  let queuedEntries = [] as QueueEntryJson[];

  for (let i = 0; i < queue.length; i++) {
    const queueItem = queue[i];

    if (isQueueEntryCompleted(queueItem)) {
      completedEntries.push({
        id: queueItem.skill,
        completed: queueItem.endTime!,
      })
    } else if (queueItem.startTime != null
        && queueItem.endTime != null
        && totalDuration != null) {
      // Active queue item
      const skillStart = Math.max(now, queueItem.startTime);
      queuedEntries.push({
        id: queueItem.skill,
        targetLevel: queueItem.targetLevel,
        proportionalStart: (skillStart - now) / totalDuration,
        proportionalEnd: (queueItem.endTime - now) / totalDuration,
        durationLabel: time.shortDurationString(skillStart, queueItem.endTime),
        progress:
            queuedEntries.length == 0 ? getTrainingProgress(queueItem) : 0,
      })
    } else {
      // Paused queue item
      queuedEntries.push({
        id: queueItem.skill,
        targetLevel: queueItem.targetLevel,
        proportionalStart: 0,
        proportionalEnd: 0,
        durationLabel: '-',
        progress: 0,
      })
    }
  }

  return {
    queued: queuedEntries,
    completed: completedEntries,
  }
}

function getRemainingDuration(queue: SkillQueueEntry[], now: number) {
  let totalDuration = null;
  let lastItem = queue.length > 0 ? queue[queue.length - 1] : null;
  if (lastItem != null && lastItem.endTime != null) {
    totalDuration = lastItem.endTime - now;
  }
  return totalDuration;
}

function getRemainingDurationLabel(queue: SkillQueueEntry[]) {
  let lastItem = queue[queue.length - 1];
  if (lastItem != null && lastItem.endTime != null) {
    return time.shortDurationString(Date.now(), lastItem.endTime);
  } else {
    return null;
  }
}
