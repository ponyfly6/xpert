/**
 * Prompt Assembler for layered system prompt construction.
 * 
 * Design Principles:
 * -分层组装：静态层 → 会话层 → 回合层
 * -渐进披露：能力信息遵循摘要优先、细节按需加载
 * -向后兼容：现有行为必须保持不变
 * 
 * Prompt Layers:
 * 1. Static Layer (静态层): agent identity, long-term rules, fixed prompts
 * 2. Session Layer (会话层): skills metadata, workspace/env, long-term memory, tool catalog summary
 * 3. Turn Layer (回合层): summary, current date, structured output schema, current input
 */

import { SystemMessage } from '@langchain/core/messages'
import { IXpertAgent } from '@xpert-ai/contracts'
import { formatMemories } from '../../../copilot-store'
import { parseXmlString } from '../../../xpert-agent/commands/handlers/types'

/**
 * Priority levels for prompt sections.
 * Lower number = added first (appears earlier in final prompt).
 */
export enum PromptSectionPriority {
    /** Agent identity, fixed rules, core prompt (static) */
    IDENTITY = 10,
    /** Skills system information (session) */
    SKILLS = 20,
    /** Memory/memories content (session) */
    MEMORIES = 30,
    /** Conversation summary (turn) */
    SUMMARY = 40,
    /** Structured output schema (turn) */
    STRUCTURED_OUTPUT = 50,
    /** Human message templates (turn) */
    HUMAN_TEMPLATES = 60,
}

/**
 * A single section of a system prompt.
 */
export interface PromptSection {
    /** Unique identifier for this section */
    id: string
    /** Priority for ordering (lower = earlier) */
    priority: PromptSectionPriority
    /** The content of this section */
    content: string
    /** Optional metadata about this section */
    metadata?: {
        layer?: 'static' | 'session' | 'turn'
        source?: string
        enabled?: boolean
    }
}

/**
 * Options for building system prompt.
 */
export interface IBuildSystemPromptOptions {
    /** Agent instance */
    agent: IXpertAgent
    /** Current date string */
    date: string
    /** Agent key */
    agentKey: string
    /** Parameters for template interpolation */
    parameters?: Record<string, unknown>
    /** Memory entries */
    memories?: Array<{ role: string; content: string }>
    /** Conversation summary */
    summary?: string
    /** Structured output JSON schema */
    jsonSchema?: string
    /** Extra prompt sections to include */
    extraSections?: PromptSection[]
}

/**
 * Result of building system prompt.
 */
export interface IBuildSystemPromptResult {
    /** Final system message content */
    content: string
    /** All sections that were assembled */
    sections: PromptSection[]
}

/**
 * Default prompt templates for common sections.
 */
export const DEFAULT_PROMPT_TEMPLATES = {
    /**
     * Build the static identity section.
     * Contains agent ID, name, and core prompt.
     */
    buildIdentitySection(
        agent: IXpertAgent,
        agentKey: string,
        agentName?: string,
        parameters?: Record<string, unknown>
    ): string {
        const name = agentName || agent.name || ''
        const prompt = parseXmlString(agent.prompt) ?? ''
        const agentId = `Your ID is '${agentKey}'.`
        const namePart = name ? `Your name is '${name}'.` : ''
        
        let identity = `Current date: {date}\n${agentId}`
        if (namePart) {
            identity += `\n${namePart}`
        }
        if (prompt) {
            identity += `\n${prompt}`
        }
        
        return identity
    },

    /**
     * Build memories section.
     */
    buildMemoriesSection(memories: Array<{ role: string; content: string }>): string {
        if (!memories?.length) return ''
        return `<memories>\n${formatMemories(memories)}\n</memories>`
    },

    /**
     * Build summary section.
     */
    buildSummarySection(summary: string): string {
        if (!summary) return ''
        return `Summary of conversation earlier: \n${summary}`
    },

    /**
     * Build structured output section with JSON schema.
     */
    buildStructuredOutputSection(jsonSchema: string): string {
        if (!jsonSchema) return ''
        return `\`\`\`json\n${jsonSchema}\n\`\`\``
    }
}

/**
 * Agent Prompt Assembler.
 * 
 * Assembles system prompt from layered sections.
 * 
 * @example
 * ```typescript
 * const assembler = new AgentPromptAssembler()
 * const result = assembler.buildSystemPrompt({
 *     agent,
 *     date: state.sys.date,
 *     agentKey: agent.key,
 *     memories: state.memories,
 *     summary: channelState?.summary,
 *     jsonSchema
 * })
 * ```
 */
export class AgentPromptAssembler {
    private sections: Map<string, PromptSection> = new Map()

    /**
     * Clear all sections.
     */
    clear(): this {
        this.sections.clear()
        return this
    }

    /**
     * Add or update a section.
     */
    addSection(section: PromptSection): this {
        this.sections.set(section.id, section)
        return this
    }

    /**
     * Remove a section by ID.
     */
    removeSection(id: string): this {
        this.sections.delete(id)
        return this
    }

    /**
     * Check if a section exists.
     */
    hasSection(id: string): boolean {
        return this.sections.has(id)
    }

    /**
     * Get a section by ID.
     */
    getSection(id: string): PromptSection | undefined {
        return this.sections.get(id)
    }

    /**
     * Get all sections sorted by priority.
     */
    getSections(): PromptSection[] {
        return Array.from(this.sections.values()).sort((a, b) => a.priority - b.priority)
    }

    /**
     * Build the final system prompt string from all sections.
     */
    build(): string {
        return this.getSections()
            .map((section) => section.content)
            .filter(Boolean)
            .join('\n\n')
    }

    /**
     * Build a SystemMessage from all sections.
     */
    buildSystemMessage(): SystemMessage {
        return new SystemMessage(this.build())
    }

    /**
     * Assemble prompt from options.
     * 
     * This is the main entry point for building system prompts.
     */
    static assemble(options: IBuildSystemPromptOptions): IBuildSystemPromptResult {
        const {
            agent,
            date,
            agentKey,
            parameters = {},
            memories,
            summary,
            jsonSchema,
            extraSections = []
        } = options

        const assembler = new AgentPromptAssembler()
        const allParameters = { ...parameters, date }

        // 1. Static Layer: Identity section
        const identityContent = DEFAULT_PROMPT_TEMPLATES.buildIdentitySection(
            agent,
            agentKey,
            undefined,
            allParameters
        )
        assembler.addSection({
            id: 'identity',
            priority: PromptSectionPriority.IDENTITY,
            content: identityContent,
            metadata: { layer: 'static', source: 'agent.prompt' }
        })

        // 2. Session Layer: Skills (if provided via extraSections)
        // Skills are added externally via addSection with SKILLS priority

        // 3. Session Layer: Memories
        const memoriesContent = DEFAULT_PROMPT_TEMPLATES.buildMemoriesSection(memories)
        if (memoriesContent) {
            assembler.addSection({
                id: 'memories',
                priority: PromptSectionPriority.MEMORIES,
                content: memoriesContent,
                metadata: { layer: 'session', source: 'state.memories' }
            })
        }

        // 4. Turn Layer: Summary
        const summaryContent = DEFAULT_PROMPT_TEMPLATES.buildSummarySection(summary)
        if (summaryContent) {
            assembler.addSection({
                id: 'summary',
                priority: PromptSectionPriority.SUMMARY,
                content: summaryContent,
                metadata: { layer: 'turn', source: 'channelState.summary' }
            })
        }

        // 5. Add extra sections (skills, etc.)
        for (const section of extraSections) {
            assembler.addSection(section)
        }

        // 6. Turn Layer: Structured output schema
        const structuredOutputContent = DEFAULT_PROMPT_TEMPLATES.buildStructuredOutputSection(jsonSchema)
        if (structuredOutputContent) {
            assembler.addSection({
                id: 'structured-output',
                priority: PromptSectionPriority.STRUCTURED_OUTPUT,
                content: structuredOutputContent,
                metadata: { layer: 'turn', source: 'jsonSchema' }
            })
        }

        return {
            content: assembler.build(),
            sections: assembler.getSections()
        }
    }

    /**
     * Build system prompt with template interpolation.
     * 
     * @deprecated Use assemble() with pre-interpolated parameters
     */
    static buildFromTemplate(
        template: string,
        parameters: Record<string, unknown>
    ): string {
        let result = template
        for (const [key, value] of Object.entries(parameters)) {
            const placeholder = `{${key}}`
            result = result.replaceAll(placeholder, String(value ?? ''))
        }
        return result
    }
}

/**
 * Helper function to interpolate template with parameters.
 */
export function interpolateTemplate(
    template: string,
    parameters: Record<string, unknown>
): string {
    return AgentPromptAssembler.buildFromTemplate(template, parameters)
}

/**
 * Skills section builder.
 * 
 * Creates a prompt section for skills metadata with progressive disclosure pattern.
 */
export function buildSkillsSection(
    skillsContent: string,
    options?: {
        priority?: PromptSectionPriority
        metadata?: PromptSection['metadata']
    }
): PromptSection {
    return {
        id: 'skills',
        priority: options?.priority ?? PromptSectionPriority.SKILLS,
        content: skillsContent,
        metadata: {
            layer: 'session',
            source: 'skills-middleware',
            ...options?.metadata
        }
    }
}

/**
 * Legacy compatibility: Build system prompt using the existing logic pattern.
 * 
 * This maintains backward compatibility with the current stateModifier implementation.
 */
export function buildLegacySystemPrompt(
    agent: IXpertAgent,
    agentKey: string,
    parameters: Record<string, unknown>,
    memories?: Array<{ role: string; content: string }>,
    summary?: string,
    jsonSchema?: string
): string {
    const date = parameters['date'] as string || new Date().toISOString().split('T')[0]
    const result = AgentPromptAssembler.assemble({
        agent,
        date,
        agentKey,
        parameters,
        memories,
        summary,
        jsonSchema
    })
    return result.content
}
