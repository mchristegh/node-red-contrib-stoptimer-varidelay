# Stop Timer (Variable Delay) Plus for Node-RED

## Why This Fork Exists
The original `node-red-contrib-stoptimer-varidelay` node by hamsando (itself a fork of the original stoptimer node by jbardi) is no longer maintained. This fork picks up where the original left off, preserving full backwards compatibility with existing flows while adding significant new functionality.

## Coexistence with Original Package
This package registers its node type as `stoptimer-varidelay-plus` which means it can coexist alongside the original `node-red-contrib-stoptimer-varidelay` package without conflict. Both can be installed and used in the same Node-RED instance at the same time.

## Installation
Search for `node-red-contrib-stoptimer-varidelay-plus` in the Node-RED Palette Manager and click Install. The node will appear in the function category.

For alternative installation methods including manual install, Home Assistant, and installing from a `.tgz` file, see the [Installation wiki page](https://github.com/mchristegh/node-red-contrib-stoptimer-varidelay/wiki/Installation).

## General Usage
Sends the received msg through the first output after the set timer duration. If a new msg is received before the timer has ended, it will replace the existing msg and the timer will be restarted, unless the new msg has a payload of a recognized control command. All control commands are **case insensitive**.

The node has 5 outputs:

| Output | Label | When it fires |
|--------|-------|---------------|
| 1 | Original Payload | When the timer expires naturally |
| 2 | Additional Payload | When the timer expires, stops, pauses, or resumes |
| 3 | Time Remaining | Countdown updates while timer is running |
| 4 | Ignored Message | When an incoming message is ignored |
| 5 | Event | Timer lifecycle events and threshold actions |

## Control Commands
All commands are case insensitive and support any combination of upper and lower case:

| Command | Description |
|---------|-------------|
| `stop` | Cancels the timer immediately |
| `pause` | Freezes the countdown at the current remaining time |
| `resume` | Restarts the countdown from the frozen point |
| `query` | Returns a full state snapshot on output 5 without affecting the timer |
| `lock` | Enables Do Not Reset Timer at runtime |
| `unlock` | Disables Do Not Reset Timer at runtime |
| `adjusttime` | Adds or subtracts time from the current remaining time (requires `msg.adjusttime`) |
| `settime` | Sets the current remaining time to an exact value (requires `msg.settime`) |
| `setduration` | Sets the timer duration for all future runs (requires `msg.setduration`) |

## Feature Summary
- **Variable delay** — configure duration in milliseconds, seconds, minutes, or hours, or override at runtime via `msg.delay` and `msg.units`
- **Case insensitive commands** — all control commands accept any case, `msg.units` accepts singular and plural forms
- **Stop** — cancel the timer at any time via `msg.payload = "stop"`
- **Pause and Resume** — freeze the countdown and resume from the same point
- **Query** — get a full snapshot of the current timer state without affecting the timer
- **Lock and Unlock** — dynamically enable or disable Do Not Reset Timer at runtime
- **Adjust Time** — add or subtract time from the current remaining time
- **Set Time** — set the current remaining time to an exact value
- **Set Duration** — set the timer duration for all future runs
- **Do Not Reset** — optionally prevent subsequent incoming messages from resetting the timer while it is running
- **Ignored Message Threshold Actions** — automatically take action (stop, pause, reset, add time, or emit warning) when a configured number of messages have been ignored
- **Persistence** — optionally resume the timer across Node-RED restarts and redeploys, including paused state and runtime lock state
- **Rich output properties** — every output carries `msg.timerState`, `msg.timerDuration`, `msg.elapsedTime`, `msg.remainingTime`, `msg.doNotResetTimer` and more
- **Configurable reporting** — update the node status and output 3 never, every second, or every minute with last-minute-by-seconds switching
- **Configurable reporting format** — HH:MM:SS, total seconds, total minutes, or total hours

## Documentation
Full documentation is available in the [project wiki](https://github.com/mchristegh/node-red-contrib-stoptimer-varidelay/wiki):

- [Installation](https://github.com/mchristegh/node-red-contrib-stoptimer-varidelay/wiki/Installation)
- [Configuration](https://github.com/mchristegh/node-red-contrib-stoptimer-varidelay/wiki/Configuration)
- [Input Messages](https://github.com/mchristegh/node-red-contrib-stoptimer-varidelay/wiki/Input-Messages)
- [Output Messages](https://github.com/mchristegh/node-red-contrib-stoptimer-varidelay/wiki/Output-Messages)
- [Timer States](https://github.com/mchristegh/node-red-contrib-stoptimer-varidelay/wiki/Timer-States)
- [Persistence](https://github.com/mchristegh/node-red-contrib-stoptimer-varidelay/wiki/Persistence)
- [Ignored Message Handling](https://github.com/mchristegh/node-red-contrib-stoptimer-varidelay/wiki/Ignored-Message-Handling)
- [Events (Output 5)](https://github.com/mchristegh/node-red-contrib-stoptimer-varidelay/wiki/Events-Output-5)
- [Troubleshooting](https://github.com/mchristegh/node-red-contrib-stoptimer-varidelay/wiki/Troubleshooting)
- [Release Notes](https://github.com/mchristegh/node-red-contrib-stoptimer-varidelay/wiki/Release-Notes)

## Examples
Practical flow examples are available in the wiki:

- [Basic Usage](https://github.com/mchristegh/node-red-contrib-stoptimer-varidelay/wiki/Examples-Basic-Usage)
- [Stop, Pause, Resume and Lock](https://github.com/mchristegh/node-red-contrib-stoptimer-varidelay/wiki/Examples-Stop-Pause-Resume-Lock)
- [Time Adjustment](https://github.com/mchristegh/node-red-contrib-stoptimer-varidelay/wiki/Examples-Time-Adjustment)
- [Ignored Messages and Thresholds](https://github.com/mchristegh/node-red-contrib-stoptimer-varidelay/wiki/Examples-Ignored-Messages-and-Thresholds)
- [Monitoring and Advanced](https://github.com/mchristegh/node-red-contrib-stoptimer-varidelay/wiki/Examples-Monitoring-and-Advanced)

## Attribution
This node is a fork of `node-red-contrib-stoptimer-varidelay` by hamsando, which itself was a fork of the original stoptimer node by jbardi. Both are licensed under the Apache 2.0 License. All original copyright notices have been preserved in the source code.

## License
Apache-2.0
