import type { EngineInterface } from 'claude-code'
import type { Action, Line2, Segment } from './layout.ts'

type Elements = ReturnType<EngineInterface['ui']['resolve']>

function segments(Text: Elements['Text'], list: readonly Segment[]) {
  return list.map(s => (
    <Text color={s.color} dimColor={s.dim} bold={s.bold}>
      {s.text}
    </Text>
  ))
}

export function Band(props: {
  el: Elements
  line1: Segment[]
  line2?: Line2
  onAction: (a: Action) => void
}) {
  const { Box, Text, Button } = props.el
  const l2 = props.line2
  return (
    <Box flexDirection="column">
      <Text wrap="truncate-end">{segments(Text, props.line1)}</Text>
      {l2 && (
        <Box flexDirection="row">
          <Box flexGrow={1}>
            <Text wrap="truncate-end">{segments(Text, l2.segments)}</Text>
          </Box>
          {l2.actions.includes('compact') && (
            <Button key="compact" label="compact" onPress={() => props.onAction('compact')} />
          )}
          {l2.actions.includes('fresh') && (
            <Button key="fresh" label="fresh start" variant="primary" onPress={() => props.onAction('fresh')} />
          )}
        </Box>
      )}
    </Box>
  )
}
