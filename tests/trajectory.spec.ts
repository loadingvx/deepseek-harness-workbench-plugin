import { describe, expect, it } from 'vitest'
import { buildTrajectoryFromMessages, overlayLiveTrajectory } from '../src/shared/trajectory-build.ts'
import { buildThreadPosts } from '../src/client/workbench/trajectory-thread.ts'

describe('trajectory build', () => {
  it('groups user turns, llm rounds, and tool calls', () => {
    const graph = buildTrajectoryFromMessages([
      { role: 'user', content: '优化 Control Plane' },
      {
        role: 'assistant',
        content: '我先读代码',
        tool_calls: [{
          id: 'tc-1',
          type: 'function',
          function: { name: 'Read', arguments: '{"path":"src/foo.ts"}' },
        }],
      },
      { role: 'tool', tool_call_id: 'tc-1', content: 'file contents' },
      { role: 'assistant', content: '已完成分析' },
    ], { modelLine: 'deepseek / chat' })

    expect(graph.userTurns).toHaveLength(1)
    expect(graph.llmTurns).toHaveLength(2)
    expect(graph.toolCalls).toHaveLength(1)
    expect(graph.toolCalls[0]?.toolName).toBe('Read')
    expect(graph.toolCalls[0]?.displayTitle).toBeTruthy()
    expect(graph.toolCalls[0]?.resultRaw).toBe('file contents')
  })

  it('creates steps from TodoWrite', () => {
    const graph = buildTrajectoryFromMessages([
      { role: 'user', content: '做任务' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [{
          id: 'tc-todo',
          type: 'function',
          function: {
            name: 'TodoWrite',
            arguments: JSON.stringify({
              todos: [
                { id: '1', content: '探索', status: 'completed' },
                { id: '2', content: '实现', status: 'in_progress' },
              ],
            }),
          },
        }],
      },
    ])

    expect(graph.steps.length).toBeGreaterThanOrEqual(2)
    expect(graph.steps.some(s => s.title === '探索')).toBe(true)
    expect(graph.steps.some(s => s.title === '实现')).toBe(true)
  })

  it('overlays live running tool calls', () => {
    const base = buildTrajectoryFromMessages([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'working', tool_calls: [] },
    ])
    const live = overlayLiveTrajectory(base, {
      running: true,
      runningCalls: [{ callId: 'live-1', toolName: 'Grep', argsRaw: '{"pattern":"x"}' }],
    })
    expect(live.toolCalls.some(c => c.id === 'live-1')).toBe(true)
    expect(live.running).toBe(true)
  })
})

describe('trajectory thread', () => {
  it('orders user then agent and tool posts with io', () => {
    const graph = buildTrajectoryFromMessages([
      { role: 'user', content: 'hello' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [{
          id: 'tc-1',
          type: 'function',
          function: { name: 'Read', arguments: '{"path":"a.ts"}' },
        }],
      },
      { role: 'tool', tool_call_id: 'tc-1', content: 'file body' },
      { role: 'assistant', content: 'done' },
    ])
    const posts = buildThreadPosts(graph)
    expect(posts[0]?.author).toBe('user')
    expect(posts.some(p => p.author === 'tool' && p.outputText === 'file body')).toBe(true)
  })
})
