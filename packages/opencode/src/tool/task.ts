import { Tool } from "./tool"
import DESCRIPTION from "./task.txt"
import z from "zod/v4"
import { Session } from "../session"
import { Bus } from "../bus"
import { MessageV2 } from "../session/message-v2"
import { Identifier } from "../id/id"
import { Agent } from "../agent/agent"
import { accessibleSubagents, isSubagentEnabled } from "../agent/subagents"
import { Config } from "../config/config"
import { SessionPrompt } from "../session/prompt"

export const TaskTool = Tool.define("task", async () => {
  // Build dynamic description placeholder – actual agent list inserted at execution time
  const description = DESCRIPTION.replace("{agents}", "(computed per invoking agent)")
  return {
    description,
    parameters: z.object({
      description: z.string().describe("A short (3-5 words) description of the task"),
      prompt: z.string().describe("The task for the agent to perform"),
      subagent_type: z.string().describe("The type of specialized agent to use for this task"),
    }),
    async execute(params, ctx) {
      const cfg = await Config.get()
      const caller = await Agent.get(ctx.agent)
      if (!caller) throw new Error(`Unknown invoking agent: ${ctx.agent}`)
      const globalMap = (cfg as any).subagents as Record<string, boolean> | undefined
      const perAgentMap = (cfg.agent?.[caller.name] as any)?.subagents as Record<string, boolean> | undefined
      const allowedList = await accessibleSubagents(caller.name)
      const agent = await Agent.get(params.subagent_type)
      if (!agent) throw new Error(`Unknown subagent: ${params.subagent_type}`)
      if (!allowedList.find((a) => a.name === agent.name)) {
        const enabledHint = allowedList.length
          ? `Enabled subagents: ${allowedList.map((a) => a.name).join(", ")}`
          : `No subagents are enabled for agent '${caller.name}'.`
        throw new Error(
          `Subagent '${agent.name}' is not enabled for agent '${caller.name}'. ${enabledHint} Configure via global 'subagents' or agent '${caller.name}'.subagents map.`,
        )
      }
      const session = await Session.create(ctx.sessionID, params.description + ` (@${agent.name} subagent)`)
      const msg = await Session.getMessage(ctx.sessionID, ctx.messageID)
      if (msg.info.role !== "assistant") throw new Error("Not an assistant message")
      const messageID = Identifier.ascending("message")
      const parts: Record<string, MessageV2.ToolPart> = {}
      const unsub = Bus.subscribe(MessageV2.Event.PartUpdated, async (evt) => {
        if (evt.properties.part.sessionID !== session.id) return
        if (evt.properties.part.messageID === messageID) return
        if (evt.properties.part.type !== "tool") return
        parts[evt.properties.part.id] = evt.properties.part
        ctx.metadata({
          title: params.description,
          metadata: {
            summary: Object.values(parts).sort((a, b) => a.id?.localeCompare(b.id)),
          },
        })
      })

      const model = agent.model ?? {
        modelID: msg.info.modelID,
        providerID: msg.info.providerID,
      }

      ctx.abort.addEventListener("abort", () => {
        SessionPrompt.abort(session.id)
      })
      const result = await SessionPrompt.prompt({
        messageID,
        sessionID: session.id,
        model: {
          modelID: model.modelID,
          providerID: model.providerID,
        },
        agent: agent.name,
        tools: {
          todowrite: false,
          todoread: false,
          task: false,
          ...agent.tools,
        },
        parts: [
          {
            id: Identifier.ascending("part"),
            type: "text",
            text: params.prompt,
          },
        ],
      })
      unsub()
      let all
      all = await Session.messages(session.id)
      all = all.filter((x) => x.info.role === "assistant")
      all = all.flatMap((msg) => msg.parts.filter((x: any) => x.type === "tool") as MessageV2.ToolPart[])
      return {
        title: params.description,
        metadata: {
          summary: all,
        },
        output: (result.parts.findLast((x: any) => x.type === "text") as any)?.text ?? "",
      }
    },
  }
})
