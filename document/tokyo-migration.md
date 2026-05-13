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

### Embedder 区域 Pin（重要）
- `backend/src/services/bedrock-embedder.ts`：东京区**没有** `nova-2-multimodal-embeddings`。
  - **不能换模型**：Nova Multimodal 与 Titan v2 的请求/响应 body 协议不同，且即使维度相同，向量空间不同会破坏现有 pgvector 数据。
  - **方案**：embedder 客户端**跨区 pin 到 `us-east-1`**（默认值），可通过 `BEDROCK_EMBED_REGION` env 覆盖。其他 Bedrock 调用仍走部署区。
  - 影响范围：`rag/document-indexer`（知识库）、`rag/rag-retriever`（向量检索）、`vector-memory.service`（Scope 长期记忆）。
- 这是和 Nova Canvas（`avatarService.ts` 固定 `us-east-1`）相同的处理模式。

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
- `backend/src/services/avatarService.ts` Nova Canvas client 锥 us-east-1（区域 pin）
- `backend/src/services/bedrock-embedder.ts` Nova Multimodal Embeddings 锥 us-east-1（默认跨区，`BEDROCK_EMBED_REGION` 可覆盖）
- `backend/AWS_SETUP.md:99-101` Nova Canvas 说明文案
- `document/bedrock-api-key-migration.md:44,174` Nova Canvas 区域 pin 变更说明

## 第二轮补丢（v2）

针对 Codex review 发现的遗漏，补改了：

- `backend/src/config/index.ts` `COGNITO_REGION` / `AWS_REGION` 默认 → `ap-northeast-1`
- `agentcore/src/agent-runner.ts` workspace S3 region fallback 与 `index.ts` 对齐
- `agentcore/Dockerfile` `ANTHROPIC_MODEL` / `WORKSPACE_S3_REGION` 默认值
- `.github/workflows/deploy-test.yml` `AWS_REGION` 默认
- `frontend/src/data/mcp-servers.ts` AWS MCP server 通用 `AWS_REGION` 默认东京（Postgres / MySQL inline 也同步）
- `frontend/src/services/cognito.ts` Hosted UI region fallback
- `backend/src/services/avatarService.ts` / `routes/avatarRoutes.ts` 头像 S3 region fallback
- `backend/src/services/project.service.ts` AgentCore workspace S3 fallback（两处）
- `backend/src/services/agentcore-command.service.ts` 容器内 S3 下载脚本 fallback
- `backend/.env.example` Cognito / AWS_REGION / AgentCore ARN / ECR / Haiku 示例
- `backend/AWS_SETUP.md` AWS_REGION 示例改东京（保留 Nova Canvas 说明）
- `document/bedrock-api-key-migration.md` 本地 / CI/CD / CloudTrail 示例
- `frontend/src/components/ConnectorPanel.tsx` placeholder
- `backend/connector-packages/{redshift,sagemaker,_template}/manifest.json` placeholder

## 待 Reviewer 确认

- LLM Proxy 模型目录里的 Moonshot / Zhipu / DeepSeek 模型 ID 没改（不带 region 前缀），需要确认这些第三方模型在东京区是否可用
- `apac.amazon.nova-pro-v1:0` / `apac.amazon.nova-lite-v1:0` 可用性
- 多租户场景下是否要支持 region-aware 模型路由（同一份代码同时部署美区 + 东京）—— 当前是硬替换，单区运行
