#!/bin/bash
# A stand-in claude executable: records the config home it was started with (first argument of the recorder is $FAKE_CLAUDE_LOG), then stays alive.
printf '%s\n' "${CLAUDE_CONFIG_DIR:-unset}" >> "${FAKE_CLAUDE_LOG}"
sleep 30
