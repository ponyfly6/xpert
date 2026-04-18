import {
    AgentPromptAssembler,
    PromptSection,
    PromptSectionPriority,
    IBuildSystemPromptOptions,
    buildSkillsSection,
    buildLegacySystemPrompt,
    interpolateTemplate
} from './prompt-assembler'

// Mock the dependencies
jest.mock('../../../copilot-store', () => ({
    formatMemories: jest.fn((memories) =>
        memories.map((m: { role: string; content: string }) => `[${m.role}]: ${m.content}`).join('\n')
    )
}))

jest.mock('../../../xpert-agent/commands/handlers/types', () => ({
    parseXmlString: jest.fn((str) => str || null)
}))

describe('AgentPromptAssembler', () => {
    const mockAgent = {
        id: 'agent-1',
        key: 'my-agent',
        name: 'Test Agent',
        prompt: 'You are a helpful assistant.',
        description: 'A test agent'
    } as any

    describe('static assemble()', () => {
        it('assembles identity section with agent info and date', () => {
            const result = AgentPromptAssembler.assemble({
                agent: mockAgent,
                date: '2024-01-15',
                agentKey: 'my-agent',
                parameters: {}
            })

            expect(result.content).toContain('Current date: 2024-01-15')
            expect(result.content).toContain("Your ID is 'my-agent'.")
            expect(result.content).toContain("Your name is 'Test Agent'.")
            expect(result.content).toContain('You are a helpful assistant.')
        })

        it('assembles memories section when provided', () => {
            const memories = [
                { role: 'user', content: 'User preference: likes coffee' },
                { role: 'assistant', content: 'Reminder: Ask about their day' }
            ]

            const result = AgentPromptAssembler.assemble({
                agent: mockAgent,
                date: '2024-01-15',
                agentKey: 'my-agent',
                parameters: {},
                memories
            })

            expect(result.content).toContain('<memories>')
            expect(result.content).toContain('[user]: User preference: likes coffee')
            expect(result.content).toContain('[assistant]: Reminder: Ask about their day')
        })

        it('does not include memories section when empty', () => {
            const result = AgentPromptAssembler.assemble({
                agent: mockAgent,
                date: '2024-01-15',
                agentKey: 'my-agent',
                parameters: {},
                memories: []
            })

            expect(result.content).not.toContain('<memories>')
        })

        it('assembles summary section when provided', () => {
            const result = AgentPromptAssembler.assemble({
                agent: mockAgent,
                date: '2024-01-15',
                agentKey: 'my-agent',
                parameters: {},
                summary: 'Previous conversation was about booking a flight.'
            })

            expect(result.content).toContain('Summary of conversation earlier:')
            expect(result.content).toContain('Previous conversation was about booking a flight.')
        })

        it('does not include summary section when empty', () => {
            const result = AgentPromptAssembler.assemble({
                agent: mockAgent,
                date: '2024-01-15',
                agentKey: 'my-agent',
                parameters: {},
                summary: ''
            })

            expect(result.content).not.toContain('Summary of conversation earlier:')
        })

        it('assembles structured output section with JSON schema', () => {
            const jsonSchema = '{"type": "object", "properties": {"name": {"type": "string"}}}'

            const result = AgentPromptAssembler.assemble({
                agent: mockAgent,
                date: '2024-01-15',
                agentKey: 'my-agent',
                parameters: {},
                jsonSchema
            })

            expect(result.content).toContain('```json')
            expect(result.content).toContain(jsonSchema)
        })

        it('does not include structured output section when empty', () => {
            const result = AgentPromptAssembler.assemble({
                agent: mockAgent,
                date: '2024-01-15',
                agentKey: 'my-agent',
                parameters: {},
                jsonSchema: ''
            })

            expect(result.content).not.toContain('```json')
        })

        it('includes extra sections in correct order', () => {
            const extraSections: PromptSection[] = [
                {
                    id: 'skills',
                    priority: PromptSectionPriority.SKILLS,
                    content: '## Skills\n- Web Research\n- Code Review'
                },
                {
                    id: 'custom',
                    priority: PromptSectionPriority.HUMAN_TEMPLATES,
                    content: 'Custom section'
                }
            ]

            const result = AgentPromptAssembler.assemble({
                agent: mockAgent,
                date: '2024-01-15',
                agentKey: 'my-agent',
                parameters: {},
                extraSections
            })

            const identityIndex = result.content.indexOf("Your ID is")
            const skillsIndex = result.content.indexOf('## Skills')
            const customIndex = result.content.indexOf('Custom section')

            expect(identityIndex).toBeLessThan(skillsIndex)
            expect(skillsIndex).toBeLessThan(customIndex)
        })

        it('returns all sections in result', () => {
            const result = AgentPromptAssembler.assemble({
                agent: mockAgent,
                date: '2024-01-15',
                agentKey: 'my-agent',
                parameters: {},
                memories: [{ role: 'user', content: 'test' }],
                summary: 'Test summary'
            })

            expect(result.sections).toBeDefined()
            expect(result.sections.length).toBeGreaterThanOrEqual(3)
            expect(result.sections.some((s) => s.id === 'identity')).toBe(true)
            expect(result.sections.some((s) => s.id === 'memories')).toBe(true)
            expect(result.sections.some((s) => s.id === 'summary')).toBe(true)
        })

        it('sections have correct metadata', () => {
            const result = AgentPromptAssembler.assemble({
                agent: mockAgent,
                date: '2024-01-15',
                agentKey: 'my-agent',
                parameters: {}
            })

            const identitySection = result.sections.find((s) => s.id === 'identity')
            expect(identitySection?.metadata?.layer).toBe('static')
            expect(identitySection?.metadata?.source).toBe('agent.prompt')
        })
    })

    describe('AgentPromptAssembler class methods', () => {
        it('clear() removes all sections', () => {
            const assembler = new AgentPromptAssembler()
            assembler.addSection({
                id: 'test',
                priority: PromptSectionPriority.IDENTITY,
                content: 'Test content'
            })

            expect(assembler.hasSection('test')).toBe(true)
            assembler.clear()
            expect(assembler.hasSection('test')).toBe(false)
        })

        it('removeSection() removes specific section', () => {
            const assembler = new AgentPromptAssembler()
            assembler.addSection({
                id: 'test',
                priority: PromptSectionPriority.IDENTITY,
                content: 'Test content'
            })

            assembler.removeSection('test')
            expect(assembler.hasSection('test')).toBe(false)
        })

        it('getSections() returns sections sorted by priority', () => {
            const assembler = new AgentPromptAssembler()
            assembler.addSection({
                id: 'last',
                priority: PromptSectionPriority.HUMAN_TEMPLATES,
                content: 'Last'
            })
            assembler.addSection({
                id: 'first',
                priority: PromptSectionPriority.IDENTITY,
                content: 'First'
            })
            assembler.addSection({
                id: 'middle',
                priority: PromptSectionPriority.MEMORIES,
                content: 'Middle'
            })

            const sections = assembler.getSections()
            expect(sections[0].id).toBe('first')
            expect(sections[1].id).toBe('middle')
            expect(sections[2].id).toBe('last')
        })

        it('build() concatenates sections with double newlines', () => {
            const assembler = new AgentPromptAssembler()
            assembler.addSection({
                id: 'first',
                priority: PromptSectionPriority.IDENTITY,
                content: 'First section'
            })
            assembler.addSection({
                id: 'second',
                priority: PromptSectionPriority.MEMORIES,
                content: 'Second section'
            })

            const result = assembler.build()
            expect(result).toBe('First section\n\nSecond section')
        })

        it('buildSystemMessage() returns SystemMessage instance', () => {
            const assembler = new AgentPromptAssembler()
            assembler.addSection({
                id: 'test',
                priority: PromptSectionPriority.IDENTITY,
                content: 'Test content'
            })

            const message = assembler.buildSystemMessage()
            expect(message.content).toBe('Test content')
        })
    })

    describe('interpolateTemplate()', () => {
        it('replaces placeholders with values', () => {
            const template = 'Hello {name}, today is {date}'
            const result = interpolateTemplate(template, { name: 'Alice', date: 'Monday' })
            expect(result).toBe('Hello Alice, today is Monday')
        })

        it('handles missing values gracefully', () => {
            const template = 'Hello {name}, your role is {role}'
            const result = interpolateTemplate(template, { name: 'Bob' })
            expect(result).toBe('Hello Bob, your role is ')
        })

        it('handles null and undefined values', () => {
            const template = 'Value: {value}'
            const result = interpolateTemplate(template, { value: null })
            expect(result).toBe('Value: ')
        })
    })

    describe('buildSkillsSection()', () => {
        it('creates a skills section with default priority', () => {
            const section = buildSkillsSection('## Skills\n- Skill 1\n- Skill 2')
            expect(section.id).toBe('skills')
            expect(section.priority).toBe(PromptSectionPriority.SKILLS)
            expect(section.content).toBe('## Skills\n- Skill 1\n- Skill 2')
            expect(section.metadata?.layer).toBe('session')
            expect(section.metadata?.source).toBe('skills-middleware')
        })

        it('allows custom priority', () => {
            const section = buildSkillsSection('Content', { priority: PromptSectionPriority.HUMAN_TEMPLATES })
            expect(section.priority).toBe(PromptSectionPriority.HUMAN_TEMPLATES)
        })
    })

    describe('buildLegacySystemPrompt()', () => {
        it('produces equivalent output to assemble()', () => {
            const options: IBuildSystemPromptOptions = {
                agent: mockAgent,
                date: '2024-01-15',
                agentKey: 'my-agent',
                parameters: { date: '2024-01-15' },
                memories: [{ role: 'user', content: 'test memory' }],
                summary: 'Test summary'
            }

            const legacyResult = buildLegacySystemPrompt(
                options.agent,
                options.agentKey,
                options.parameters,
                options.memories,
                options.summary
            )

            const assemblerResult = AgentPromptAssembler.assemble(options)

            expect(legacyResult).toContain('Current date:')
            expect(legacyResult).toContain("Your ID is 'my-agent'")
            expect(legacyResult).toContain('<memories>')
            expect(legacyResult).toContain('Summary of conversation')
        })
    })

    describe('Prompt Layers Order', () => {
        it('assembles in correct layer order: static → session → turn', () => {
            const extraSections: PromptSection[] = [
                {
                    id: 'skills',
                    priority: PromptSectionPriority.SKILLS,
                    content: '[SKILLS]'
                }
            ]

            const result = AgentPromptAssembler.assemble({
                agent: mockAgent,
                date: '2024-01-15',
                agentKey: 'my-agent',
                parameters: {},
                memories: [{ role: 'user', content: '[MEMORIES]' }],
                summary: '[SUMMARY]',
                extraSections,
                jsonSchema: '[JSON_SCHEMA]'
            })

            const identityPos = result.content.indexOf("Your ID is")
            const skillsPos = result.content.indexOf('[SKILLS]')
            const memoriesPos = result.content.indexOf('[MEMORIES]')
            const summaryPos = result.content.indexOf('[SUMMARY]')
            const schemaPos = result.content.indexOf('[JSON_SCHEMA]')

            expect(identityPos).toBeLessThan(skillsPos)
            expect(skillsPos).toBeLessThan(memoriesPos)
            expect(memoriesPos).toBeLessThan(summaryPos)
            expect(summaryPos).toBeLessThan(schemaPos)
        })
    })
})
