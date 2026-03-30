# Feature Request: Add ZhipuAI GLM-4.7 support

## Summary
The ZhipuAI provider already ships several GLM-4.x model presets, but GLM-4.7 is not available. This issue proposes adding the new model definition so users can select it from the provider list and use it in runtime requests.

## Current Behavior
- ZhipuAI model presets are defined under `packages/server-ai/src/ai-model/model_providers/zhipuai/llm/` and ordered in `_position.yaml`.
- The web UI has a curated Zhipu model list in `packages/copilot/src/lib/types/providers.ts`.
- GLM-4.7 is not present in either location, so it cannot be chosen in the UI and is not available as a preset.

## Proposed Solution
1. Add a new model YAML definition for `glm-4.7` under the ZhipuAI model provider directory.
2. Register the model in `_position.yaml` so it appears in the preset ordering.
3. Add the model to the Zhipu UI list for discoverability.

## Acceptance Criteria
- [ ] `glm-4.7` appears in the ZhipuAI model presets list.
- [ ] The UI model list includes GLM-4.7.
- [ ] Documentation or metadata notes (context size, pricing, features) are defined in the model YAML.

## References
- ZhipuAI model presets: `packages/server-ai/src/ai-model/model_providers/zhipuai/llm/`
- ZhipuAI UI model list: `packages/copilot/src/lib/types/providers.ts`
