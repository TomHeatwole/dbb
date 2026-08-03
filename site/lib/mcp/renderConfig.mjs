/**
 * renderConfig.mjs — output rendering mode for value-heavy tools.
 *
 * The value tools (evaluate_trade, get_player_value, get_team_value_summary)
 * compute the same numbers in every mode; the mode only controls how results
 * are FORMATTED:
 *
 *   'full' — internal model names + raw value totals (the original output).
 *            Meant for direct human consumption via the standalone MCP server.
 *
 *   'soft' — user-safe signals only: public KTC/FantasyCalc figures, ranks,
 *            percentage gaps, pick equivalents, and qualitative timeline
 *            labels. Internal model names and raw totals never appear, so the
 *            chat AI cannot leak them.
 */

export const RENDER_MODE_FULL = 'full';
export const RENDER_MODE_SOFT = 'soft';

/** Mode for tool results fed to HwangAI chat (api/chat.mjs). */
export const CHAT_TOOL_RENDER_MODE = RENDER_MODE_SOFT;

/** Mode for the standalone MCP server (mcp/index.js). */
export const MCP_TOOL_RENDER_MODE = RENDER_MODE_FULL;
