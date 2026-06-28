# Stop Timer (Variable Delay) Plus for Node-RED #

## Why This Fork Exists ##
The original `node-red-contrib-stoptimer-varidelay` node by hamsando (itself a fork of the original stoptimer node by jbardi) is no longer maintained. This fork picks up where the original left off, adding new features while preserving full backwards compatibility with existing flows. If you are already using `node-red-contrib-stoptimer-varidelay`, you can switch to this package without changing any of your existing flows.

## General Usage ##
Sends the received msg through the first output after the set timer duration. If a new msg is received before the timer has ended, it will replace the existing msg and the timer will be restarted, unless the new msg has a payload of `stop`, `STOP`, `pause`, `PAUSE`, `resume`, or `RESUME`. The second output allows you to send an additional payload of a number, string or boolean when the timer completes. If the timer is stopped, the second and third outputs will automatically send a payload of `stopped`. The third output will send the time remaining as time ticks away.

The status below the node as well as the third output can be configured to update at a frequency of:
* Never (default)
* Every Second
* Every Minute, Last minute by seconds

The last option works as follows:
* While there is more than 1 minute remaining, the timer will decrement every minute. At the 1 minute point, it will switch to reporting every second.
* The exception to this rule is if your duration is not a minute increment. In that case, the first update will be for the partial minute, after which it will operate as noted above. (for example: 2.5 minutes will decrement to 2 minutes, then 1 minute, then every second down to zero)

The format of the 3rd output reporting (and status) are defined by the "Reporting Format" option. The default is hh:mm:ss (string), but it can be configured to present that as the total number of remaining seconds, minutes or hours (number).

## Message Properties ##
All output messages include the following additional properties:
* `msg.timerState` — the current state of the timer: `running`, `paused`, `stopped`, or `expired`
* `msg.timerDuration` — the original timer duration in milliseconds (outputs 1, 2, and 3)
* `msg.elapsedTime` — the time elapsed since the timer started in milliseconds (outputs 1, 2, and 3)
* `msg.remainingTime` — the remaining time in milliseconds (outputs 3 and 4)

## Overriding the Node via Incoming Messages ##
If the input contains `msg.delay`, then the delay will be `msg.delay` units of time, where the units are whatever the units are defaulted to in the node itself. In the absence of a `msg.delay`, or a value in `msg.delay` that cannot be converted to an int, the value configured within the node will be used. If the value of `msg.delay` is less than 0, then 0 is used.

If the input contains `msg.units`, with a value of "Milliseconds", "Seconds", "Minutes" or "Hours" then that will override what is defaulted in the node. In the absence of a `msg.units`, or an unknown string in `msg.units`, the units configured within the node will be used. In the case of an unknown string, a warning message will appear in the Debug logs.

### Special Note on Milliseconds ###
While you can set Milliseconds, I would not rely on the accuracy for anything critical. For the purposes of the node status and output 3, except in the case where Reporting is set to None, the milliseconds are not displayed or provided on the 3rd output as it wouldn't make sense based on the available reporting rates.

## Pausing and Resuming ##
The timer can be paused by sending a message with `msg.payload` of `pause` or `PAUSE`. While paused:
* The countdown is frozen at the remaining time
* The node status shows `Paused: HH:MM:SS` with a yellow indicator
* Outputs 2 and 3 will send a payload of `paused`
* Any incoming message other than `resume`, `RESUME`, `stop`, or `STOP` will be routed to output 4
* Sending another `pause` message while already paused will also be routed to output 4

The timer can be resumed by sending a message with `msg.payload` of `resume` or `RESUME`. On resume:
* The countdown restarts from where it was frozen
* Outputs 2 and 3 will send a payload of `resumed`

If the *Resume timer on deploy/restart* option is enabled and the timer is paused when Node-RED restarts or the flow is redeployed, the timer will restore as paused at the same remaining time.

## Do Not Reset Timer on Subsequent Incoming Message ##
This option is **DISABLED** by default. If you **ENABLE** it (check the checkbox) then while the timer is running, any subsequent incoming messages (other than `stop`, `STOP`, `pause`, `PAUSE`, `resume`, or `RESUME`) will be ignored and the timer will continue running undisturbed. The first message always starts the timer normally.

When a message is ignored, it will be sent to the 4th output with the original message content intact plus:
* `msg.remainingTime` — remaining time in milliseconds
* `msg.timerState` — current timer state

When this option is enabled, the node status will show:
`Remaining: 00:04:32 | Ignored: 3, Last: Jun 27 14:22:05`

The ignored count and last ignored datetime will reset each time a new message starts the timer. They will remain visible on the status after the timer expires or is stopped, so you can see how many messages were ignored during that timer run.

## Resume Timer on Deploy/Restart ##
This option is **DISABLED** by default. If you **ENABLE** it (check the checkbox) then if the stoptimer is running and you re-Deploy the flow, or restart Node-RED, then the timer will automatically restart itself where it should be. What does that mean? A couple of examples will help here.
* If you had a 10 minute stoptimer running, with 6 minutes elapsed (ie: 4 minutes left) and you hit Deploy, normally the stoptimer would no longer be running, but if you have this feature enabled, the timer will continue running from the 6 minute mark (ie: counting down 4 more minutes and then trigger).
* If you had a 10 minute stoptimer running, with 6 minutes elapsed (ie: 4 minutes left) and you *stopped* Node-RED for 2 minutes and then restarted it, normally the stoptimer would no longer be running, but if you have this feature enabled, the timer will continue running from the 8 minute mark (6 minutes from the original run + 2 minutes of Node-RED downtime) -- counting down 2 more minutes and then trigger.
* **Special Case** If on restart or re-Deploy, there is less than 3 seconds remaining on the stoptimer (or if the stoptimer should have elapsed already) then the stoptimer is set to a random amount between 3 and 8 seconds. This helps to ensure that anything else that needs to initialize before the stoptimer triggers has a chance to do so. It also helps so that if you happen to have a lot of timers, they don't all trigger at once and flood unsuspecting nodes/devices.

This persistence is **not** related to "Persistent Context" (the contextStorage option in `settings.js`). When the "Resume timer" option is enabled in the node, the node will store timer related information in a `stvd-timers` subdirectory of *userDir* (where *userDir* is defined in `settings.js`). If *userDir* is not explicitly defined, it defaults to a directory called `.node-red` in your home user directory. The files in this directory will be created/destroyed as needed by the node.

## _timerpass ##
**What is *_timerpass*?**

*_timerpass* is a property added to messages exiting the 1st/top and 2nd/middle outputs of stoptimer.
*_timerpass* is set to **true** when the timer expires.

**What does *_timerpass* do?**
If stoptimer has at any point been stopped using message.payload=stop (or STOP) AND
If stoptimer has not received a message with _timerpass not set since that time THEN
any incoming message that has the _timerpass=true property will die within stoptimer with no output.

This can be problematic if you want to chain multiple stoptimers together. It is not insurmountable, but it can be irritating.

**Why does this behavior exist?**
It is a legacy thing, it was part of the original stoptimer whose code I forked. Not sure what exactly the original intent was, but I'm sure there is some rationale.

**How does Stoptimer-Varidelay handle this?**
*Ignore Timerpass* in the node config dialog. If enabled in a given stoptimer-varidelay node, it will ignore the presence of the `_timerpass` property on an incoming message and will process the incoming message as it does every other message.

By default, this option is not enabled in order to preserve compatibility with any existing flows. Note that you may need to refresh the web UI after updating the node in order to see the new "ignore timerpass" option.

## Attribution ##
This node is a fork of `node-red-contrib-stoptimer-varidelay` by hamsando, which itself was a fork of the original stoptimer node by jbardi. Both are licensed under the Apache 2.0 License. All original copyright notices have been preserved in the source code.

## Release Notes ##

0.5.8
- mchristegh: Fixed `writeState(null)` bug in threshold pause action that could cause decycle errors — now safely passes empty object when no message is available
- mchristegh: Fixed reporting intervals (countdown, miniTimeout) not restarting correctly after threshold reset and addtime actions
- mchristegh: Fixed miniTimeout partial minute edge case not being handled correctly after threshold reset and addtime actions
- mchristegh: Extracted `startTimeout()` helper to centralize setTimeout/maxTimeout chaining logic and eliminate code duplication
- mchristegh: Extracted `startReporting()` helper to centralize all countdown/interval reporting logic and eliminate code duplication
- mchristegh: Extracted `clearAllTimers()` helper to centralize timer cleanup and eliminate code duplication
- mchristegh: Added `timerStartTime` to persisted state — `msg.elapsedTime` now accurate across Node-RED restarts and redeploys
- mchristegh: Added `timerState` to persisted state for accurate state restoration on restart
- mchristegh: Added `ignoredCount` and `lastIgnoredTime` to persisted state for accurate threshold firing across restarts
- mchristegh: Added `msg.timerEvent = "started"` on output 5 when timer starts or restarts
- mchristegh: Added `msg.timerEvent = "paused"` on output 5 when timer is paused
- mchristegh: Added `msg.timerEvent = "resumed"` on output 5 when timer is resumed
- mchristegh: Fixed pause handler to persist original message rather than the pause command itself

0.5.7
- mchristegh: Added query message support — send `msg.payload = "query"` or `"QUERY"` to get a full snapshot of the current timer state on output 5 without affecting the timer
- mchristegh: Added 5th output "Event" for timer events including query responses and threshold actions
- mchristegh: Added ignored message threshold action — configurable action to take when ignored message count reaches a threshold (Do Nothing, Stop, Pause, Reset Timer, Add Time, Emit Warning)
- mchristegh: Threshold actions fire repeatedly every N ignored messages (count resets after each action except Do Nothing and Emit Warning)
- mchristegh: Add Time threshold action includes its own amount and units fields independent of the node's main timer units
- mchristegh: All threshold actions send on output 5 with `msg.timerEvent` indicating the action taken
- mchristegh: `msg.timeAdded` included on output 5 for Add Time threshold action, in milliseconds

0.5.6
- mchristegh: Fixed status blanking out when a duplicate pause message is received while already paused
- mchristegh: Fixed status blanking out when a non-stop/resume message is received while paused
- mchristegh: Fixed status blanking out when a resume message is received but timer is not paused
- mchristegh: Fixed status blanking out when a pause message is received but timer is not running
- mchristegh: Added `msg.ignoredCount` to output 4 indicating number of messages ignored during current timer run
- mchristegh: Added `msg.lastIgnoredTime` to output 4 as an ISO 8601 timestamp of the last ignored message

0.5.5
- mchristegh: Renamed node type registration from `stoptimer-varidelay` to `stoptimer-varidelay-plus` to allow coexistence with the original `node-red-contrib-stoptimer-varidelay` package
  
0.5.4
- mchristegh: Forked from node-red-contrib-stoptimer-varidelay (hamsando) and published as node-red-contrib-stoptimer-varidelay-plus
- mchristegh: Added pause/resume support via msg.payload of `pause`/`PAUSE` and `resume`/`RESUME`
- mchristegh: Added `msg.timerState` property to all outputs indicating current timer state (`running`, `paused`, `stopped`, `expired`)
- mchristegh: Added `msg.timerDuration` property to outputs 1, 2, and 3 indicating original timer duration in milliseconds
- mchristegh: Added `msg.elapsedTime` property to outputs 1, 2, and 3 indicating elapsed time in milliseconds
- mchristegh: Added `msg.remainingTime` property to output 3 reporting messages and output 4
- mchristegh: Added "Do Not Reset Timer on Subsequent Incoming Message" option — when enabled, subsequent messages while the timer is running are ignored and routed to output 4
- mchristegh: Added 4th output for ignored messages, carrying original message content plus `msg.remainingTime` and `msg.timerState`
- mchristegh: Enhanced node status to show ignored message count and last ignored datetime when "Do Not Reset" option is enabled
- mchristegh: Pause state is now persisted across restarts/redeploys when "Resume timer on deploy/restart" is enabled
- mchristegh: Persist now also saves and restores ignored count and last ignored datetime
- mchristegh: Fixed pre-existing bug where `$("#node-input-reportingformat").value()` was called instead of `.val()` in the HTML

0.5.3
- putch: Added a drop-down to indicate what format you want the countdown (3rd output and node status) to be in. Default is HH:MM:SS.
- putch: Added some example flows.

0.5.2
- putch: Fixed issue where if the node was in a subflow of a subflow (ie: more than just in a flow or single level deep subflow) the restart/redeploy functionality would not work. This fix breaks the solution in 0.5.0. Upon initial restart after upgrading to 0.5.2, nodes within subflows won't restart if there were in progress (and you will have orphan node state files). Solution as suggested by tobi-bo.

0.5.1
- putch: Corrected documentation omission.

0.5.0
- putch: Fixed an issue where if the node was in a subflow, it was exceedingly unlikely that it would successfully resume after restart/redeploy.
- putch: Fixed an issue where if the node status was "stopped" and a new message came in with _timerpass=true, the node status was cleared (but the node was still in "stopped" state so it could be unclear why it may ignore a new message. Now the status "stopped" remains.
- putch: Added an optional feature to ignore incoming _timerpass=true flags. See README or Node help for details.
- putch: Added a node status (expired) for when the timer expires.

0.4.7
- putch: Fixed issue where if the node was directly configured to a delay of 0 (regardless of units) in the dialog box, then the node would actually delay 5 (whatever units).
- putch: Fixed issue where if the node was directly configured to a value with a decimal (for example 10.5) in the dialog box, then the node would actually truncate the fractional part (10.5 becomes 10).

0.4.6
- putch: Fixed an issue where the 2nd output would always output True when set to boolean

0.4.5
- putch: Fixed issue where the restarting of the timer after NR restart broke in NR 1.2.x.

0.4.4
- putch: Fixed an issue where if the delay was longer than 24 days, the timer would fire immediately

0.4.3
- putch: Fixed a logging issue if there is an issue reading the persistent data on restart
- putch: Switched from parse/stringify to decycle/retrocycle to handle JSON with cyclical data

0.4.2
- putch: Move location of saved persistent data to a subdir of userDir
- putch: Added additional documentation clarifying no relation to persistent context configuration.

0.4.1
- putch: Changed location of saved persistent data
- putch: Remove persistent data for node if node is deleted

0.4.0
- putch: Optimized code which displays the countdown
- putch: Fixed missing 'Units' label in node config screen.
- putch: Added stoptimer countdown persistence across Deploy/Restart

0.3.2
- putch: Fixed time output when time is greater/equal 24 hours

0.3.1
- putch: Fixed, 3rd output should output 'stopped' if the stoptimer is sent 'stop' command

0.3.0
- putch: Changed the way that time is shown in the node status (from text Seconds/Minutes/Hours to HH:MM:SS)
- putch: Added support for 3rd output indicating time remaining
- putch: Added option to define the rate of updates.
- putch: Cleaned up internal references of node name
- putch: Fixed milliseconds timer setting
- putch: Fixed icon

0.2.0
- putch: Added support for msg.units field to over-ride the units set in the node.

0.1.1
- putch: Simple support for msg.delay field to set the delay duration

0.1.0
- merc1031: Simple support for setting time from environment to allow parametrized use in subflows

0.0.7
- Clarified the instructions with respect to what happens to the existing message when a new message arrives.

0.0.6
- Forgot to update the "info" panel instructions inside of node-red to include the new features.

0.0.5
- As per request, included a second output. You can set the payload for the second output to a number, string or boolean, however, if the timer is stopped with an incoming msg, the second output will send the payload of "stopped".

0.0.4
- Updated icon for less confusion with other nodes

0.0.3
- README.md update

0.0.2
- Fixed an issue with using the timer in a repeating flow which caused it to either send an additional msg after being stopped, or, in some cases, not allowing a new msg to pass through after the node had been previously stopped.

0.0.1
- Initial Release
