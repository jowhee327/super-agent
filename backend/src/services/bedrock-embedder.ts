/**
 * Bedrock Embedder — generates text embeddings using Amazon Nova Multimodal Embeddings.
 *
 * Model: amazon.nova-2-multimodal-embeddings-v1:0
 * Dimensions: 1024 (configurable: 256, 384, 1024, 3072)
 *
 * Region pin: nova-2-multimodal-embeddings is NOT available in ap-northeast-1
 * (Tokyo). The embedder client is therefore pinned cross-region — by default
 * to us-east-1 (override via BEDROCK_EMBED_REGION env). Using a different
 * model on Tokyo would change embedding semantics and dimensions, breaking
 * pgvector compatibility for stored RAG / scope memory vectors.
 */

import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';
import { createBedrockClient } from './bedrock-client.js';

const MODEL_ID = process.env.BEDROCK_EMBED_MODEL_ID ?? 'amazon.nova-2-multimodal-embeddings-v1:0';
const EMBED_REGION = process.env.BEDROCK_EMBED_REGION ?? 'us-east-1';
const EMBEDDING_DIMENSION = 1024;

// Cross-region pinned client — see header comment.
const bedrockClient: BedrockRuntimeClient = createBedrockClient({ region: EMBED_REGION });

export async function embedText(text: string): Promise<number[]> {
  const body = {
    taskType: 'SINGLE_EMBEDDING',
    singleEmbeddingParams: {
      embeddingPurpose: 'GENERIC_INDEX',
      embeddingDimension: EMBEDDING_DIMENSION,
      text: { truncationMode: 'END', value: text.slice(0, 8000) },
    },
  };

  const command = new InvokeModelCommand({
    modelId: MODEL_ID,
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify(body),
  });

  const response = await bedrockClient.send(command);
  const result = JSON.parse(new TextDecoder().decode(response.body));

  const embedding: number[] | undefined = result?.embeddings?.[0]?.embedding;
  if (!embedding || embedding.length !== EMBEDDING_DIMENSION) {
    throw new Error(`Unexpected embedding response: got ${embedding?.length ?? 0} dims, expected ${EMBEDDING_DIMENSION}`);
  }

  return embedding;
}

export { EMBEDDING_DIMENSION };
