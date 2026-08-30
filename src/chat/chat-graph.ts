import {
  StateGraph,
  START,
  END,
  type BaseCheckpointSaver,
  type CompiledStateGraph,
} from '@langchain/langgraph';
import type { Repository } from 'typeorm';
import type { Place, Trip } from '../database/entities';
import type { TripsService } from '../trips/trips.service';
import { ChatAnnotation, type ChatState, type ChatUpdate } from './chat-state';
import { createValidateInputNode } from './nodes/validate-input.node';
import { createClassifyIntentNode } from './nodes/classify-intent.node';
import { createLoadVerifiedFactsNode } from './nodes/load-verified-facts.node';
import { createAnswerGroundedQuestionNode } from './nodes/answer-grounded-question.node';
import { createCreateTripNode } from './nodes/create-trip.node';
import { createClarifyNode } from './nodes/clarify.node';
import { createResolveModificationTargetNode } from './nodes/resolve-modification-target.node';
import { createFindReplacementCandidatesNode } from './nodes/find-replacement-candidates.node';
import { createRequestApprovalNode } from './nodes/request-approval.node';
import { createExecuteModificationNode } from './nodes/execute-modification.node';
import {
  createEnrichPlaceDetailsNode,
  shouldEnrichPlaceDetails,
} from './nodes/enrich-place-details.node';
import type { PlaceDetailEnrichmentGateway } from '../place-details/place-detail-evidence.types';

export interface ChatGraphDependencies {
  placesRepo: Repository<Place>;
  tripsRepo: Repository<Trip>;
  tripsService: TripsService;
  openaiApiKey?: string;
  placeDetailEnrichment?: PlaceDetailEnrichmentGateway;
  checkpointer?: BaseCheckpointSaver;
}

export type ChatWorkflowGraph = CompiledStateGraph<
  ChatState,
  ChatUpdate,
  string,
  typeof ChatAnnotation.spec
>;

export function createChatGraph(deps: ChatGraphDependencies): ChatWorkflowGraph {
  const workflow = new StateGraph(ChatAnnotation)
    // 1. Register Nodes
    .addNode('validate_input', createValidateInputNode())
    .addNode('classify_intent', createClassifyIntentNode())
    .addNode('load_verified_facts', createLoadVerifiedFactsNode(deps.placesRepo, deps.tripsRepo))
    .addNode('enrich_place_details', createEnrichPlaceDetailsNode(deps.placeDetailEnrichment))
    .addNode('answer_grounded', createAnswerGroundedQuestionNode())
    .addNode('create_trip', createCreateTripNode(deps.tripsService))
    .addNode('clarify', createClarifyNode())
    .addNode('resolve_target', createResolveModificationTargetNode(deps.tripsRepo))
    .addNode(
      'find_alternatives',
      createFindReplacementCandidatesNode(deps.placesRepo, deps.tripsRepo),
    )
    .addNode('request_approval', createRequestApprovalNode())
    .addNode('execute_modification', createExecuteModificationNode(deps.tripsService))

    // 2. Add Edges
    .addEdge(START, 'validate_input')

    // Conditional from validate_input
    .addConditionalEdges('validate_input', (state: ChatState) => {
      if (state.responseMessage) {
        return END;
      }
      return 'classify_intent';
    })

    // Conditional from classify_intent
    .addConditionalEdges('classify_intent', (state: ChatState) => {
      switch (state.intent) {
        case 'qa':
          return 'load_verified_facts';
        case 'create_trip':
          return 'create_trip';
        case 'modify_trip':
          return 'resolve_target';
        case 'clarify':
        default:
          return 'clarify';
      }
    })

    // Linear flow for QA
    .addConditionalEdges('load_verified_facts', (state: ChatState) =>
      shouldEnrichPlaceDetails(state) ? 'enrich_place_details' : 'answer_grounded',
    )
    .addEdge('enrich_place_details', 'answer_grounded')
    .addEdge('answer_grounded', END)

    // Linear flow for trip creation and clarification
    .addEdge('create_trip', END)
    .addEdge('clarify', END)

    // Modification flow
    .addConditionalEdges('resolve_target', (state: ChatState) => {
      if (state.errorCode) {
        return END;
      }
      return 'find_alternatives';
    })

    .addConditionalEdges('find_alternatives', (state: ChatState) => {
      if (state.status === 'failed' || state.errorCode) {
        return END;
      }
      return 'request_approval';
    })

    .addConditionalEdges('request_approval', (state: ChatState) => {
      if (state.status === 'rejected' || state.status === 'failed') {
        return END;
      }
      return 'execute_modification';
    })

    .addEdge('execute_modification', END);

  return workflow.compile({
    checkpointer: deps.checkpointer,
  });
}
