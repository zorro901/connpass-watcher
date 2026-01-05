import type { Config } from "../config/schema.js";
import { analyzeSpeakerOpportunity } from "../connpass/parser.js";
import type { ConnpassEvent, EnrichedEvent, SpeakerOpportunity } from "../connpass/types.js";
import { createChildLogger } from "../utils/logger.js";

const logger = createChildLogger("matcher:speaker");

/**
 * 登壇可能性を判定
 */
export function checkSpeakerOpportunity(event: ConnpassEvent, config: Config): SpeakerOpportunity {
  if (!config.speaker.check_participant_types && !config.speaker.check_cfp) {
    logger.debug({ eventId: event.id }, "Speaker check disabled");
    return {
      has_opportunity: false,
      has_lt_slot: false,
      has_cfp: false,
      detected_keywords: [],
    };
  }

  const result = analyzeSpeakerOpportunity(event);

  // 設定に応じてフィルタリング
  const filteredResult: SpeakerOpportunity = {
    has_opportunity: false,
    has_lt_slot: config.speaker.check_participant_types ? result.has_lt_slot : false,
    has_cfp: config.speaker.check_cfp ? result.has_cfp : false,
    detected_keywords: result.detected_keywords,
  };

  filteredResult.has_opportunity = filteredResult.has_lt_slot || filteredResult.has_cfp;

  if (filteredResult.has_opportunity) {
    logger.info(
      {
        eventId: event.id,
        title: event.title,
        hasLtSlot: filteredResult.has_lt_slot,
        hasCfp: filteredResult.has_cfp,
        keywords: filteredResult.detected_keywords,
      },
      "Speaker opportunity detected",
    );
  }

  return filteredResult;
}

/**
 * イベントに登壇可能性情報を付加
 */
export function enrichWithSpeakerOpportunity(event: EnrichedEvent, config: Config): EnrichedEvent {
  return {
    ...event,
    speaker_opportunity: checkSpeakerOpportunity(event, config),
  };
}
