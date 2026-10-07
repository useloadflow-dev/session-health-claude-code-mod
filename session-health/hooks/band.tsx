import type { EngineInterface } from 'claude-code'
import { BUTTON_HOTKEY, BUTTON_LABEL, type Action, type Line2, type Segment } from './layout.ts'

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
          {l2.actions.map(a => (
            <Box flexShrink={0} marginLeft={1}>
              <Button
                key={a}
                label={BUTTON_LABEL[a]}
                hotkey={BUTTON_HOTKEY[a]}
                variant={a === 'fresh' ? 'primary' : undefined}
                onPress={() => props.onAction(a)}
              />
            </Box>
          ))}
        </Box>
      )}
    </Box>
  )
}
