import { AgentAction } from './expert_schema';

export type PluginMessage =
  | { type: 'AI_ACTION'; action: AgentAction }
  | { type: 'resize'; width: number; height: number }
  | { type: 'log'; message: string };

export interface FigmaMessage {
  pluginMessage: PluginMessage;
}
