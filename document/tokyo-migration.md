# 东京区（ap-northeast-1）迁移说明

本分支把 Super Agent 默认部署区从 `us-west-2` 切到 **`ap-northeast-1`（东京）**。

## 已确认的东京区资源可用性

通过 `aws bedrock list-foundation-models / list-inference-profiles --region ap-northeast-1` 实测：

- **Foundation models**：Claude Sonnet 4 / 4.5 / 4.6、Haiku 4.5、Opus 4.5 / 4.6 / 4.7、Nova 2 Lite/Sonic、Titan Embed v1/v2、Rerank 1.0
- **Inference profiles**：`jp.*`（日本本地）、`apac.*`（亚太）、`global.*`（全球兜底）三套都有
- **Bedrock AgentCore Control plane**：`aws bedrock-agentcore-control list-agent-runtimes --region ap-northeast-1` 已可用，区域内闭环 OK

## 改动清单

### Region 硬编码
- `infra/bin/app.ts`：CDK 默认 region → `ap-northeast-1`
- `infra/scripts/deploy.sh` / `deploy-full.sh`：`REGION` 默认值
- `infra/scripts/setup-litellm.sh`：`AWS_REGION`
- `infra/scripts/user-data.sh`：CloudWatch agent region 改为通过 IMDSv2 在启动时动态注入；`fetch-db-url.sh` fallback 改为 `ap-northeast-1`
- `agentcore/src/index.ts`：`WORKSPACE_S3_REGION` 默认从 `us-east-1` 改为读 `WORKSPACE_S3_REGION` → `AWS_REGION` → `ap-northeast-1`

### 模型 ID 映射（推理 Profile 前缀）
| Service | 原 ID | 新 ID |
|---|---|---|
| `backend/src/utils/claude-config.ts` 映射表 | `us.anthropic.*` | `jp.anthropic.*`（Opus 4.6 → `global.*`），并新增 Opus 4.7 / Sonnet 4 |
| `backend/src/services/distillation.service.ts` Haiku 4.5 | `us.*` | `jp.*` |
| `backend/src/services/briefing-generator.service.ts` Haiku 4.5 | `us.*` | `jp.*` |
| `backend/src/routes/showcase.routes.ts` Haiku 4.5 | `us.*` | `jp.*` |
| `backend/src/services/ai.service.ts` Nova 2 Lite | `us.amazon.nova-2-lite-v1:0` | `jp.amazon.nova-2-lite-v1:0` |
| `backend/src/services/rehearsal.service.ts` Nova 2 Lite | 同上 | 同上 |
| `backend/src/services/llm-proxy/types.ts` 模型目录 | `us.*` | `jp.*` / `global.*` / `apac.*`（按可用性） |
| `infra/scripts/ci/gen-base-env.py` `CLAUDE_MODEL` 默认 | `us.anthropic.claude-opus-4-6-v1` | `global.anthropic.claude-opus-4-6-v1` |
| `infra/scripts/deploy-full.sh` AgentCore env `ANTHROPIC_MODEL` | 同上 | 同上 |
| `infra/scripts/setup-litellm.sh` LiteLLM 模型表 | `us.*` | `jp.*` / `global.*` |

### Embedder 降级
- `backend/src/services/bedrock-embedder.ts`：东京区**没有** `nova-2-multimodal-embeddings`，默认改为 `amazon.titan-embed-text-v2:0`（区域内可用）。可通过 `BEDROCK_EMBED_MODEL_ID` 环境变量覆盖。
- ⚠️ Titan v2 是**纯文本** embedder，如果系统真用到了多模态 embedding，需要把 embedder 客户端 region 显式指到 `us-east-1` 跨区调用。

### 测试
- `backend/tests/unit/claude-config.test.ts` 期望值同步更新。

## 部署前 Checklist

1. **申请模型权限**：去 Tokyo Bedrock Console → Model Access，开通：Claude Sonnet 4/4.5/4.6、Haiku 4.5、Opus 4.6（global profile）、Nova 2 Lite、Titan Embed v2
2. **CDK Bootstrap**：`npx cdk bootstrap aws://<ACCOUNT>/ap-northeast-1`
3. **EC2 Key Pair**：在 ap-northeast-1 创建好
4. **可选**：ACM 证书（CloudFront 用）依然必须在 us-east-1，CDK 已正确处理
5. 部署：`./infra/scripts/deploy-full.sh --region ap-northeast-1`

## 保留的 us-east-1 引用（合理）

- `infra/lib/super-agent-stack.ts` ACM 证书 → CloudFront 强制 us-east-1，**不要改**
- `backend/AWS_SETUP.md` / `document/bedrock-api-key-migration.md` 提到 Nova Canvas 固定 us-east-1，是 SDK 客户端层的 region pin，跨区调用，与部署区无关

## 待 Reviewer 确认

- LLM Proxy 模型目录里的 Moonshot / Zhipu / DeepSeek 模型 ID 没改（不带 region 前缀），需要确认这些第三方模型在东京区是否可用
- `apac.amazon.nova-pro-v1:0` / `apac.amazon.nova-lite-v1:0` 可用性
- 多租户场景下是否要支持 region-aware 模型路由（同一份代码同时部署美区 + 东京）—— 当前是硬替换，单区运行
