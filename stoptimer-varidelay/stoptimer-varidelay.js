/**
 * Modifications copyright (C) 2025 mchristegh
 * Modifications copyright (C) 2020 hamsando
 * Copyright jbardi
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * stoptimer-varidelay-plus
 * A Node-RED timer node with variable delay, pause/resume, persistence,
 * ignored message handling, threshold actions, heartbeat, and rich output
 * properties.
 **/

module.exports = function(RED) {
  "use strict";

  // ---------------------------------------------------------------------------
  // Module-level constants
  // ---------------------------------------------------------------------------

  const TIMER_STATE = {
    RUNNING: "running",
    PAUSED:  "paused",
    STOPPED: "stopped",
    EXPIRED: "expired"
  };

  const TIMER_EVENT = {
    STARTED:              "started",
    PAUSED:               "paused",
    RESUMED:              "resumed",
    STOPPED:              "stopped",
    EXPIRED:              "expired",
    QUERY:                "query",
    LOCKED:               "locked",
    UNLOCKED:             "unlocked",
    DISABLED:             "disabled",
    ENABLED:              "enabled",
    TIMEADJUSTED:         "timeadjusted",
    TIMESET:              "timeset",
    DURATIONSET:          "durationset",
    HEARTBEAT:            "heartbeat",
    THRESHOLD_STOPPED:    "threshold_stopped",
    THRESHOLD_PAUSED:     "threshold_paused",
    THRESHOLD_RESET:      "threshold_reset",
    THRESHOLD_TIME_ADDED: "threshold_time_added",
    THRESHOLD_WARNING:    "threshold_warning"
  };

  const UNITS = {
    MILLISECOND: "Millisecond",
    SECOND:      "Second",
    MINUTE:      "Minute",
    HOUR:        "Hour"
  };

  const UNITS_INPUT = {
    MILLISECOND: "millisecond",
    SECOND:      "second",
    MINUTE:      "minute",
    HOUR:        "hour"
  };

  const THRESHOLD_ACTION = {
    DONOTHING: "donothing",
    STOP:      "stop",
    PAUSE:     "pause",
    RESET:     "reset",
    ADDTIME:   "addtime",
    WARNING:   "warning"
  };

  const PAYLOAD = {
    STOP:        "stop",
    PAUSE:       "pause",
    RESUME:      "resume",
    QUERY:       "query",
    LOCK:        "lock",
    UNLOCK:      "unlock",
    DISABLE:     "disable",
    ENABLE:      "enable",
    ADJUSTTIME:  "adjusttime",
    SETTIME:     "settime",
    SETDURATION: "setduration"
  };

  const REPORTING_FORMAT = {
    HUMAN:   "human",
    SECONDS: "seconds",
    MINUTES: "minutes",
    HOURS:   "hours"
  };

  const REPORTING = {
    NONE:                "none",
    EVERY_SECOND:        "every_second",
    LAST_MINUTE_SECONDS: "last_minute_seconds"
  };

  // ---------------------------------------------------------------------------
  // Node definition
  // ---------------------------------------------------------------------------

  function StopTimerVariDelay(n) {
    RED.nodes.createNode(this, n);
    let fs   = require('fs');
    let path = require('path');
    let nodefile = n.id.toString();
    let nodepath = "";
    require('./cycle.js');

    if (n._alias != null) {
      nodepath = n._flow.path.replace(/\//g, "-") + "-";
      nodefile = n._alias;
    }

    const stvdtimersFile = path.join(RED.settings.userDir, "stvd-timers", nodepath + nodefile);

    // -------------------------------------------------------------------------
    // Node property initialization
    // -------------------------------------------------------------------------

    this.units                 = n.units                 || UNITS.SECOND;
    this.durationType          = n.durationType;
    this.duration              = isNaN(Number(RED.util.evaluateNodeProperty(n.duration, this.durationType, this, null))) ? 5 : Number(RED.util.evaluateNodeProperty(n.duration, this.durationType, this, null));
    this.payloadval            = n.payloadval            || "0";
    this.payloadtype           = n.payloadtype           || "num";
    this.reporting             = n.reporting             || REPORTING.NONE;
    this.reportingformat       = n.reportingformat       || REPORTING_FORMAT.HUMAN;
    this.persist               = n.persist               || false;
    this.ignoretimerpass       = n.ignoretimerpass       || false;
    this.donotresettimer       = n.donotresettimer       || false;
    this.thresholdaction       = n.thresholdaction       || THRESHOLD_ACTION.DONOTHING;
    this.thresholdcount        = isNaN(Number(n.thresholdcount))   ? 0 : Number(n.thresholdcount);
    this.thresholdaddtime      = isNaN(Number(n.thresholdaddtime)) ? 0 : Number(n.thresholdaddtime);
    this.thresholdaddtimeunits = n.thresholdaddtimeunits || UNITS.SECOND;
    this.heartbeatinterval      = isNaN(Number(n.heartbeatinterval)) ? 0 : Number(n.heartbeatinterval);
    this.heartbeatintervalunits = n.heartbeatintervalunits || UNITS.SECOND;

    if (this.duration <= 0) {
      this.duration = 0;
    } else {
      if (this.units === UNITS.SECOND) this.duration = this.duration * 1000;
      if (this.units === UNITS.MINUTE) this.duration = this.duration * 1000 * 60;
      if (this.units === UNITS.HOUR)   this.duration = this.duration * 1000 * 60 * 60;
    }

    if ((this.payloadtype === "num") && (!isNaN(this.payloadval))) {
      this.payloadval = Number(this.payloadval);
    } else if (this.payloadval === 'true' || this.payloadval === 'false') {
      this.payloadval = this.payloadval === 'true';
    } else if (this.payloadval === "null") {
      this.payloadtype = 'null';
      this.payloadval  = null;
    } else {
      this.payloadval = String(this.payloadval);
    }

    let node = this;

    // -------------------------------------------------------------------------
    // Runtime state variables
    // -------------------------------------------------------------------------

    let timeout               = null;
    let miniTimeout           = null;
    let countdown             = null;
    let heartbeatTimer        = null;   // setInterval handle for heartbeat, independent of clearAllTimers
    let stopped               = false;
    let paused                = false;
    let disabled              = false;
    let delayRemainingDisplay = 0;
    let delayFactor           = 1000;
    let reporting             = this.reporting;
    let reportingformat       = this.reportingformat;

    const maxTimeout = 2147483647;
    let actualDelayInUse      = 0;
    let actualDelayRemaining  = 0;

    let ignoredCount          = 0;
    let lastIgnoredTime       = null;
    let timerRunning          = false;
    let timerState            = TIMER_STATE.STOPPED;
    let timerStartTime        = null;
    let timerDuration         = 0;
    let originalMsg           = null;
    let overrideDuration      = null;

    // -------------------------------------------------------------------------
    // Persist restore
    // -------------------------------------------------------------------------

    if (this.persist === true) {
      try {
        if (fs.existsSync(stvdtimersFile)) {
          let savedState = JSON.retrocycle(JSON.parse(readState()));
          let targetMS   = (new Date(savedState.time.toString())).getTime();
          let nowMS      = (new Date()).getTime();

          this.reporting       = savedState.reporting.toString();
          this.reportingformat = typeof savedState.reportingformat !== 'undefined'
            ? savedState.reportingformat.toString()
            : REPORTING_FORMAT.HUMAN;

          if (typeof savedState.ignoredCount     !== 'undefined') ignoredCount         = savedState.ignoredCount;
          if (typeof savedState.lastIgnoredTime  !== 'undefined' && savedState.lastIgnoredTime !== null) {
            lastIgnoredTime = new Date(savedState.lastIgnoredTime);
          }
          if (typeof savedState.timerStartTime   !== 'undefined' && savedState.timerStartTime !== null) {
            timerStartTime = new Date(savedState.timerStartTime);
          }
          if (typeof savedState.timerState       !== 'undefined') timerState           = savedState.timerState;
          if (typeof savedState.donotresettimer  !== 'undefined') node.donotresettimer = savedState.donotresettimer;
          if (typeof savedState.overrideDuration !== 'undefined' && savedState.overrideDuration !== null) {
            overrideDuration = savedState.overrideDuration;
          }
          if (typeof savedState.disabled !== 'undefined') disabled = savedState.disabled;

          if (savedState.paused === true) {
            let remainingMS = targetMS - nowMS;
            if (remainingMS <= 0) remainingMS = (Math.floor((Math.random() * 5) + 3) * 1000);
            delayRemainingDisplay = remainingMS;
            timerDuration  = typeof savedState.timerDuration !== 'undefined' ? savedState.timerDuration : remainingMS;
            timerStartTime = new Date(nowMS - (timerDuration - remainingMS));
            paused         = true;
            timerRunning   = false;
            timerState     = TIMER_STATE.PAUSED;
            node.status(buildStatus(displayTime(delayRemainingDisplay, node.reportingformat), TIMER_STATE.PAUSED));
            // Heartbeat restarts fresh after a restore — does not recalculate original schedule
            startHeartbeat();
          } else {
            if ((targetMS - nowMS) <= 3000) {
              targetMS = (Math.floor((Math.random() * 5) + 3) * 1000);
            } else {
              targetMS = (Math.round((targetMS - nowMS) / 1000)) * 1000;
            }
            savedState.origmsg.units = UNITS_INPUT.MILLISECOND;
            savedState.origmsg.delay = targetMS;
            if (typeof savedState.timerDuration !== 'undefined') timerDuration = savedState.timerDuration;
            handleInputEvent(savedState.origmsg, true);
          }
        }
      } catch (error) {
        this.error("Error processing persistent file data for stoptimer-varidelay node " + n.id.toString() + "\n\n" + error.toString());
      }
    } else {
      deleteState();
    }

    // -------------------------------------------------------------------------
    // Event listeners
    // -------------------------------------------------------------------------

    this.on("input", function(msg) {
      handleInputEvent(msg, false);
    });

    this.on("close", function(removed, done) {
      if (timeout)        clearTimeout(timeout);
      if (countdown)       clearInterval(countdown);
      if (miniTimeout)     clearTimeout(miniTimeout);
      if (heartbeatTimer)  clearInterval(heartbeatTimer);
      node.status({});
      if (removed) deleteState();
      done();
    });

    // -------------------------------------------------------------------------
    // Status helper
    // -------------------------------------------------------------------------

    function buildStatus(timeDisplay, state) {
      let baseText = "";
      let fill     = "green";
      let shape    = "dot";

      if (state === TIMER_STATE.STOPPED || state === TIMER_STATE.EXPIRED) {
        fill  = state === TIMER_STATE.STOPPED ? "red" : "blue";
        shape = state === TIMER_STATE.STOPPED ? "ring" : "square";
        if (node.donotresettimer) {
          let lastStr    = lastIgnoredTime ? formatIgnoredTime(lastIgnoredTime) : "--";
          let stateLabel = state === TIMER_STATE.STOPPED ? "Stopped" : "Expired";
          baseText = stateLabel + " | Ignored: " + ignoredCount + ", Last: " + lastStr;
        } else {
          baseText = state === TIMER_STATE.STOPPED ? "stopped" : "expired";
        }
      } else if (state === TIMER_STATE.PAUSED) {
        fill  = "yellow";
        shape = "ring";
        if (node.donotresettimer) {
          let lastStr = lastIgnoredTime ? formatIgnoredTime(lastIgnoredTime) : "--";
          baseText = "Paused: " + timeDisplay + " | Ignored: " + ignoredCount + ", Last: " + lastStr;
        } else {
          baseText = "Paused: " + timeDisplay;
        }
      } else {
        fill  = "green";
        shape = "dot";
        if (node.donotresettimer) {
          let lastStr = lastIgnoredTime ? formatIgnoredTime(lastIgnoredTime) : "--";
          baseText = "Remaining: " + timeDisplay + " | Ignored: " + ignoredCount + ", Last: " + lastStr;
        } else {
          baseText = timeDisplay;
        }
      }

      if (disabled) {
        return { fill: "grey", shape: "ring", text: "Disabled | " + baseText };
      }

      return { fill: fill, shape: shape, text: baseText };
    }

    // -------------------------------------------------------------------------
    // Utility helpers
    // -------------------------------------------------------------------------

    function formatIgnoredTime(date) {
      const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
      return months[date.getMonth()]                    + " " +
             String(date.getDate()).padStart(2, "0")    + " " +
             String(date.getHours()).padStart(2, "0")   + ":" +
             String(date.getMinutes()).padStart(2, "0") + ":" +
             String(date.getSeconds()).padStart(2, "0");
    }

    function getElapsedTime() {
      if (timerStartTime === null) return 0;
      return (new Date()).getTime() - timerStartTime.getTime();
    }

    function convertToMilliseconds(value, units) {
      switch (units) {
        case UNITS.SECOND:      return value * 1000;
        case UNITS.MINUTE:      return value * 1000 * 60;
        case UNITS.HOUR:        return value * 1000 * 60 * 60;
        case UNITS.MILLISECOND: return value;
        default:                return value;
      }
    }

    function normalizeUnits(units) {
      return typeof units === 'string' ? units.toLowerCase().replace(/s$/, '') : null;
    }

    function msgValueToMs(value, units) {
      switch (units) {
        case UNITS_INPUT.SECOND: return value * 1000;
        case UNITS_INPUT.MINUTE: return value * 1000 * 60;
        case UNITS_INPUT.HOUR:   return value * 1000 * 60 * 60;
        default:                 return value;
      }
    }

    function buildEventMessage(timerEvent) {
      return {
        timerEvent:       timerEvent,
        timerState:       timerState,
        remainingTime:    delayRemainingDisplay,
        timerDuration:    timerDuration,
        elapsedTime:      getElapsedTime(),
        ignoredCount:     ignoredCount,
        lastIgnoredTime:  lastIgnoredTime ? lastIgnoredTime.toISOString() : null,
        doNotResetTimer:  node.donotresettimer,
        disabled:         disabled
      };
    }

    // -------------------------------------------------------------------------
    // Timer management helpers
    // -------------------------------------------------------------------------

    /**
     * Clears the main timeout, countdown interval, and miniTimeout.
     * Does NOT clear the heartbeat — heartbeat runs on a fixed schedule
     * independent of pause/resume/adjusttime/settime/threshold actions.
     */
    function clearAllTimers() {
      clearTimeout(timeout);
      clearTimeout(miniTimeout);
      clearInterval(countdown);
      timeout     = null;
      countdown   = null;
      miniTimeout = null;
    }

    /**
     * Starts the heartbeat interval if heartbeatinterval is configured (> 0).
     * Clears any existing heartbeat interval first to avoid duplicates.
     * Runs on a fixed wall-clock schedule, unaffected by pause, resume,
     * adjusttime, settime, or threshold actions. Fires while running AND
     * while paused. Only stopped explicitly when the timer stops or expires.
     */
    function startHeartbeat() {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
      if (node.heartbeatinterval > 0) {
        let intervalMS = convertToMilliseconds(node.heartbeatinterval, node.heartbeatintervalunits);
        if (intervalMS > 0) {
          heartbeatTimer = setInterval(function() {
            node.send([null, null, null, null, buildEventMessage(TIMER_EVENT.HEARTBEAT)]);
          }, intervalMS);
        }
      }
    }

    /**
     * Stops the heartbeat interval. Called when the timer stops or expires.
     */
    function stopHeartbeat() {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
    }

    function startTimeout(msg) {
      actualDelayRemaining = delayRemainingDisplay;
      if (actualDelayRemaining > maxTimeout) {
        actualDelayInUse     = maxTimeout;
        actualDelayRemaining = actualDelayRemaining - maxTimeout;
      } else {
        actualDelayInUse     = actualDelayRemaining;
        actualDelayRemaining = 0;
      }
      timeout = setTimeout(timerElapsed, actualDelayInUse, msg);
    }

    function startReporting(msg) {
      if (reporting === REPORTING.NONE) {
        node.status(buildStatus(displayTime(delayRemainingDisplay, reportingformat), TIMER_STATE.RUNNING));
        return;
      }

      node.status(buildStatus(displayTime(delayRemainingDisplay, reportingformat), TIMER_STATE.RUNNING));
      node.send([null, null, {
        payload:       displayTime(delayRemainingDisplay, reportingformat),
        timerState:    timerState,
        remainingTime: delayRemainingDisplay,
        timerDuration: timerDuration,
        elapsedTime:   getElapsedTime()
      }, null, null]);

      if ((delayRemainingDisplay > 60000) && (reporting === REPORTING.LAST_MINUTE_SECONDS)) {
        miniTimeout = setTimeout(function() {
          if ((delayRemainingDisplay % 60000) !== 0) {
            delayRemainingDisplay -= (delayRemainingDisplay % 60000);
            node.status(buildStatus(displayTime(delayRemainingDisplay, reportingformat), TIMER_STATE.RUNNING));
            node.send([null, null, {
              payload:       displayTime(delayRemainingDisplay, reportingformat),
              timerState:    timerState,
              remainingTime: delayRemainingDisplay,
              timerDuration: timerDuration,
              elapsedTime:   getElapsedTime()
            }, null, null]);
          }

          if (delayRemainingDisplay <= 60000) {
            countdown = setInterval(function() {
              delayRemainingDisplay -= 1000;
              node.status(buildStatus(displayTime(delayRemainingDisplay, reportingformat), TIMER_STATE.RUNNING));
              node.send([null, null, {
                payload:       displayTime(delayRemainingDisplay, reportingformat),
                timerState:    timerState,
                remainingTime: delayRemainingDisplay,
                timerDuration: timerDuration,
                elapsedTime:   getElapsedTime()
              }, null, null]);
            }, 1000);
          } else {
            countdown = setInterval(function() {
              if (delayRemainingDisplay > 60000) {
                delayRemainingDisplay -= 60000;
                node.status(buildStatus(displayTime(delayRemainingDisplay, reportingformat), TIMER_STATE.RUNNING));
                node.send([null, null, {
                  payload:       displayTime(delayRemainingDisplay, reportingformat),
                  timerState:    timerState,
                  remainingTime: delayRemainingDisplay,
                  timerDuration: timerDuration,
                  elapsedTime:   getElapsedTime()
                }, null, null]);
              }
              if (delayRemainingDisplay <= 60000) {
                clearInterval(countdown);
                countdown = null;
                countdown = setInterval(function() {
                  delayRemainingDisplay -= 1000;
                  node.status(buildStatus(displayTime(delayRemainingDisplay, reportingformat), TIMER_STATE.RUNNING));
                  node.send([null, null, {
                    payload:       displayTime(delayRemainingDisplay, reportingformat),
                    timerState:    timerState,
                    remainingTime: delayRemainingDisplay,
                    timerDuration: timerDuration,
                    elapsedTime:   getElapsedTime()
                  }, null, null]);
                }, 1000);
              }
            }, 60000);
          }
          miniTimeout = null;
        }, delayRemainingDisplay % 60000);

      } else {
        countdown = setInterval(function() {
          delayRemainingDisplay -= 1000;
          node.status(buildStatus(displayTime(delayRemainingDisplay, reportingformat), TIMER_STATE.RUNNING));
          node.send([null, null, {
            payload:       displayTime(delayRemainingDisplay, reportingformat),
            timerState:    timerState,
            remainingTime: delayRemainingDisplay,
            timerDuration: timerDuration,
            elapsedTime:   getElapsedTime()
          }, null, null]);
        }, 1000);
      }
    }

    // -------------------------------------------------------------------------
    // Threshold action handler
    // -------------------------------------------------------------------------

    function handleThresholdAction() {
      if (node.thresholdaction === THRESHOLD_ACTION.DONOTHING || node.thresholdcount <= 0) return;
      if (ignoredCount % node.thresholdcount !== 0) return;

      let msg5 = null;

      switch (node.thresholdaction) {

        case THRESHOLD_ACTION.STOP:
          timerRunning    = false;
          timerState      = TIMER_STATE.STOPPED;
          stopped         = true;
          clearAllTimers();
          stopHeartbeat();
          deleteState();
          ignoredCount    = 0;
          lastIgnoredTime = null;
          node.status(buildStatus(null, TIMER_STATE.STOPPED));
          node.send([null, null, null, null, buildEventMessage(TIMER_EVENT.THRESHOLD_STOPPED)]);
          node.send([null, null, null, null, buildEventMessage(TIMER_EVENT.STOPPED)]);
          break;

        case THRESHOLD_ACTION.PAUSE:
          if (timerRunning) {
            timerRunning    = false;
            timerState      = TIMER_STATE.PAUSED;
            paused          = true;
            clearAllTimers();
            writeState(originalMsg);
            ignoredCount    = 0;
            lastIgnoredTime = null;
            node.status(buildStatus(displayTime(delayRemainingDisplay, reportingformat), TIMER_STATE.PAUSED));
            node.send([null, null, null, null, buildEventMessage(TIMER_EVENT.THRESHOLD_PAUSED)]);
            node.send([null, null, null, null, buildEventMessage(TIMER_EVENT.PAUSED)]);
          }
          break;

        case THRESHOLD_ACTION.RESET:
          clearAllTimers();
          delayRemainingDisplay = timerDuration;
          timerStartTime        = new Date();
          ignoredCount          = 0;
          lastIgnoredTime       = null;
          writeState(originalMsg);
          node.send([null, null, null, null, buildEventMessage(TIMER_EVENT.THRESHOLD_RESET)]);
          if (paused) {
            node.status(buildStatus(displayTime(delayRemainingDisplay, reportingformat), TIMER_STATE.PAUSED));
          } else {
            timerState   = TIMER_STATE.RUNNING;
            timerRunning = true;
            node.send([null, null, null, null, buildEventMessage(TIMER_EVENT.STARTED)]);
            startTimeout(originalMsg);
            startReporting(originalMsg);
          }
          break;

        case THRESHOLD_ACTION.ADDTIME:
          let addTimeMS         = convertToMilliseconds(node.thresholdaddtime, node.thresholdaddtimeunits);
          clearAllTimers();
          delayRemainingDisplay += addTimeMS;
          msg5                  = buildEventMessage(TIMER_EVENT.THRESHOLD_TIME_ADDED);
          msg5.timeAdded        = addTimeMS;
          ignoredCount          = 0;
          lastIgnoredTime       = null;
          writeState(originalMsg);
          node.send([null, null, null, null, msg5]);
          if (paused) {
            node.status(buildStatus(displayTime(delayRemainingDisplay, reportingformat), TIMER_STATE.PAUSED));
          } else {
            timerState   = TIMER_STATE.RUNNING;
            timerRunning = true;
            startTimeout(originalMsg);
            startReporting(originalMsg);
          }
          break;

        case THRESHOLD_ACTION.WARNING:
          msg5 = buildEventMessage(TIMER_EVENT.THRESHOLD_WARNING);
          node.send([null, null, null, null, msg5]);
          break;
      }
    }

    // -------------------------------------------------------------------------
    // Input event handler
    // -------------------------------------------------------------------------

    function handleInputEvent(msg, isRestore) {
      node.status({});

      const msgPayload = typeof msg.payload === 'string' ? msg.payload.toLowerCase() : msg.payload;
      const msgUnits   = normalizeUnits(msg.units);

      reporting       = node.reporting;
      reportingformat = node.reportingformat;

      // -- Query -----------------------------------------------------------
      if (msgPayload === PAYLOAD.QUERY) {
        node.status(buildStatus(displayTime(delayRemainingDisplay, reportingformat), timerState));
        node.send([null, null, null, null, buildEventMessage(TIMER_EVENT.QUERY)]);
        return;
      }

      // -- Disable ---------------------------------------------------------
      if (msgPayload === PAYLOAD.DISABLE) {
        if (disabled) {
          ignoredCount++;
          lastIgnoredTime      = new Date();
          let msg4             = RED.util.cloneMessage(msg);
          msg4.remainingTime   = delayRemainingDisplay;
          msg4.timerState      = timerState;
          msg4.ignoredCount    = ignoredCount;
          msg4.lastIgnoredTime = lastIgnoredTime.toISOString();
          node.status(buildStatus(displayTime(delayRemainingDisplay, reportingformat), timerState));
          node.send([null, null, null, msg4, null]);
          return;
        }
        disabled = true;
        writeState(originalMsg);
        node.status(buildStatus(displayTime(delayRemainingDisplay, reportingformat), timerState));
        node.send([null, null, null, null, buildEventMessage(TIMER_EVENT.DISABLED)]);
        return;
      }

      // -- Enable ----------------------------------------------------------
      if (msgPayload === PAYLOAD.ENABLE) {
        disabled = false;
        writeState(originalMsg);
        node.status(buildStatus(displayTime(delayRemainingDisplay, reportingformat), timerState));
        node.send([null, null, null, null, buildEventMessage(TIMER_EVENT.ENABLED)]);
        return;
      }

      // -- Lock ------------------------------------------------------------
      if (msgPayload === PAYLOAD.LOCK) {
        node.donotresettimer = true;
        ignoredCount         = 0;
        lastIgnoredTime      = null;
        writeState(originalMsg);
        node.status(buildStatus(displayTime(delayRemainingDisplay, reportingformat), timerState));
        node.send([null, null, null, null, buildEventMessage(TIMER_EVENT.LOCKED)]);
        return;
      }

      // -- Unlock ----------------------------------------------------------
      if (msgPayload === PAYLOAD.UNLOCK) {
        node.donotresettimer = false;
        ignoredCount         = 0;
        lastIgnoredTime      = null;
        writeState(originalMsg);
        node.status(buildStatus(displayTime(delayRemainingDisplay, reportingformat), timerState));
        node.send([null, null, null, null, buildEventMessage(TIMER_EVENT.UNLOCKED)]);
        return;
      }

      // -- Adjust Time -----------------------------------------------------
      if (msgPayload === PAYLOAD.ADJUSTTIME) {
        if (timerRunning || paused) {
          let adjustUnits       = normalizeUnits(msg.adjusttimeunits);
          let adjustMS          = msgValueToMs(msg.adjusttime, adjustUnits);
          delayRemainingDisplay = Math.max(0, delayRemainingDisplay + adjustMS);
          let msg5              = buildEventMessage(TIMER_EVENT.TIMEADJUSTED);
          msg5.timeAdjusted     = adjustMS;
          writeState(originalMsg);
          if (paused) {
            node.status(buildStatus(displayTime(delayRemainingDisplay, reportingformat), TIMER_STATE.PAUSED));
          } else {
            clearAllTimers();
            startTimeout(originalMsg);
            startReporting(originalMsg);
          }
          node.send([null, null, null, null, msg5]);
        } else {
          node.status(buildStatus(displayTime(delayRemainingDisplay, reportingformat), timerState));
        }
        return;
      }

      // -- Set Time --------------------------------------------------------
      if (msgPayload === PAYLOAD.SETTIME) {
        if (timerRunning || paused) {
          let setUnits  = normalizeUnits(msg.settimeunits);
          let setMS     = msgValueToMs(msg.settime, setUnits);
          if (setMS <= 0) {
            node.warn("settime value must be positive, ignoring");
            node.status(buildStatus(displayTime(delayRemainingDisplay, reportingformat), timerState));
            return;
          }
          delayRemainingDisplay = setMS;
          let msg5      = buildEventMessage(TIMER_EVENT.TIMESET);
          msg5.timeSet  = setMS;
          writeState(originalMsg);
          if (paused) {
            node.status(buildStatus(displayTime(delayRemainingDisplay, reportingformat), TIMER_STATE.PAUSED));
          } else {
            clearAllTimers();
            startTimeout(originalMsg);
            startReporting(originalMsg);
          }
          node.send([null, null, null, null, msg5]);
        } else {
          node.status(buildStatus(displayTime(delayRemainingDisplay, reportingformat), timerState));
        }
        return;
      }

      // -- Set Duration ----------------------------------------------------
      if (msgPayload === PAYLOAD.SETDURATION) {
        let durUnits     = normalizeUnits(msg.setdurationunits);
        let durMS        = msgValueToMs(msg.setduration, durUnits);
        if (durMS <= 0) {
          node.warn("setduration value must be positive, ignoring");
          node.status(buildStatus(displayTime(delayRemainingDisplay, reportingformat), timerState));
          return;
        }
        overrideDuration  = durMS;
        let msg5          = buildEventMessage(TIMER_EVENT.DURATIONSET);
        msg5.durationSet  = durMS;
        writeState(originalMsg);
        node.status(buildStatus(displayTime(delayRemainingDisplay, reportingformat), timerState));
        node.send([null, null, null, null, msg5]);
        return;
      }

      // -- Pause -----------------------------------------------------------
      if (msgPayload === PAYLOAD.PAUSE) {
        if (paused) {
          let msg4             = RED.util.cloneMessage(msg);
          msg4.remainingTime   = delayRemainingDisplay;
          msg4.timerState      = timerState;
          msg4.ignoredCount    = ignoredCount;
          msg4.lastIgnoredTime = lastIgnoredTime ? lastIgnoredTime.toISOString() : null;
          node.status(buildStatus(displayTime(delayRemainingDisplay, reportingformat), TIMER_STATE.PAUSED));
          node.send([null, null, null, msg4, null]);
          return;
        }
        if (timerRunning) {
          clearAllTimers();
          paused       = true;
          timerRunning = false;
          timerState   = TIMER_STATE.PAUSED;
          writeState(originalMsg);
          node.status(buildStatus(displayTime(delayRemainingDisplay, reportingformat), TIMER_STATE.PAUSED));
          let msg2           = RED.util.cloneMessage(msg);
          msg2.payload       = "paused";
          msg2.timerState    = timerState;
          msg2.timerDuration = timerDuration;
          msg2.elapsedTime   = getElapsedTime();
          let msg3 = {
            payload:       displayTime(delayRemainingDisplay, reportingformat),
            timerState:    timerState,
            remainingTime: delayRemainingDisplay,
            timerDuration: timerDuration,
            elapsedTime:   getElapsedTime()
          };
          node.send([null, msg2, msg3, null, buildEventMessage(TIMER_EVENT.PAUSED)]);
        } else {
          node.status(buildStatus(displayTime(delayRemainingDisplay, reportingformat), timerState));
        }
        return;
      }

      // -- Resume ----------------------------------------------------------
      if (msgPayload === PAYLOAD.RESUME) {
        if (paused) {
          paused         = false;
          timerRunning   = true;
          timerState     = TIMER_STATE.RUNNING;
          timerStartTime = new Date((new Date()).getTime() - (timerDuration - delayRemainingDisplay));
          writeState(originalMsg);
          let msg2           = RED.util.cloneMessage(msg);
          msg2.payload       = "resumed";
          msg2.timerState    = timerState;
          msg2.timerDuration = timerDuration;
          msg2.elapsedTime   = getElapsedTime();
          let msg3 = {
            payload:       displayTime(delayRemainingDisplay, reportingformat),
            timerState:    timerState,
            remainingTime: delayRemainingDisplay,
            timerDuration: timerDuration,
            elapsedTime:   getElapsedTime()
          };
          node.send([null, msg2, msg3, null, buildEventMessage(TIMER_EVENT.RESUMED)]);
          startTimeout(originalMsg);
          startReporting(originalMsg);
        } else {
          node.status(buildStatus(displayTime(delayRemainingDisplay, reportingformat), timerState));
        }
        return;
      }

      // -- Paused gate -----------------------------------------------------
      if (paused && msgPayload !== PAYLOAD.STOP) {
        ignoredCount++;
        lastIgnoredTime      = new Date();
        node.status(buildStatus(displayTime(delayRemainingDisplay, reportingformat), TIMER_STATE.PAUSED));
        let msg4             = RED.util.cloneMessage(msg);
        msg4.remainingTime   = delayRemainingDisplay;
        msg4.timerState      = timerState;
        msg4.ignoredCount    = ignoredCount;
        msg4.lastIgnoredTime = lastIgnoredTime.toISOString();
        node.send([null, null, null, msg4, null]);
        handleThresholdAction();
        return;
      }

      // -- _timerpass gate -------------------------------------------------
      if (stopped === false || msg._timerpass !== true || node.ignoretimerpass === true) {

        // -- donotresettimer gate ------------------------------------------
        if (node.donotresettimer && timerRunning && msgPayload !== PAYLOAD.STOP && msg._timerpass !== true) {
          ignoredCount++;
          lastIgnoredTime      = new Date();
          node.status(buildStatus(displayTime(delayRemainingDisplay, reportingformat), TIMER_STATE.RUNNING));
          let msg4             = RED.util.cloneMessage(msg);
          msg4.remainingTime   = delayRemainingDisplay;
          msg4.timerState      = timerState;
          msg4.ignoredCount    = ignoredCount;
          msg4.lastIgnoredTime = lastIgnoredTime.toISOString();
          node.send([null, null, null, msg4, null]);
          handleThresholdAction();
          return;
        }

        stopped = false;
        paused  = false;
        clearAllTimers();

        // -- Stop ----------------------------------------------------------
        if (msgPayload === PAYLOAD.STOP) {
          timerRunning       = false;
          timerState         = TIMER_STATE.STOPPED;
          stopped            = true;
          stopHeartbeat();
          let msg2           = RED.util.cloneMessage(msg);
          msg2.payload       = "stopped";
          msg2.timerState    = timerState;
          msg2.timerDuration = timerDuration;
          msg2.elapsedTime   = getElapsedTime();
          deleteState();
          ignoredCount    = 0;
          lastIgnoredTime = null;
          node.status(buildStatus(null, TIMER_STATE.STOPPED));
          node.send([null, msg2, msg2, null, buildEventMessage(TIMER_EVENT.STOPPED)]);
          return;
        }

        // -- Disabled gate -------------------------------------------------
        if (disabled && !isRestore) {
          ignoredCount++;
          lastIgnoredTime      = new Date();
          node.status(buildStatus(displayTime(delayRemainingDisplay, reportingformat), timerState));
          let msg4             = RED.util.cloneMessage(msg);
          msg4.remainingTime   = delayRemainingDisplay;
          msg4.timerState      = timerState;
          msg4.ignoredCount    = ignoredCount;
          msg4.lastIgnoredTime = lastIgnoredTime.toISOString();
          node.send([null, null, null, msg4, null]);
          handleThresholdAction();
          return;
        }

        // -- Start / Restart -----------------------------------------------
        msg._timerpass = true;

        if (msgUnits !== null) {
          switch (msgUnits) {
            case UNITS_INPUT.MILLISECOND: delayFactor = 1;                break;
            case UNITS_INPUT.SECOND:      delayFactor = 1000;             break;
            case UNITS_INPUT.MINUTE:      delayFactor = 1000 * 60;        break;
            case UNITS_INPUT.HOUR:        delayFactor = 1000 * 60 * 60;   break;
            default:
              node.warn("Unknown units in message, using node default: " + node.units);
              delayFactor = convertToMilliseconds(1, node.units);
          }
        } else {
          delayFactor = convertToMilliseconds(1, node.units);
        }

        if ((msg.delay != null) && (!isNaN(parseInt(msg.delay, 10)))) {
          delayRemainingDisplay = msg.delay * delayFactor;
        } else {
          delayRemainingDisplay = overrideDuration !== null ? overrideDuration : node.duration;
          overrideDuration      = null;
        }

        ignoredCount    = 0;
        lastIgnoredTime = null;
        timerRunning    = true;
        timerState      = TIMER_STATE.RUNNING;
        timerStartTime  = new Date();
        timerDuration   = delayRemainingDisplay;
        originalMsg     = msg;

        writeState(msg);
        node.send([null, null, null, null, buildEventMessage(TIMER_EVENT.STARTED)]);
        startTimeout(msg);
        startReporting(msg);
        startHeartbeat();

      } else {
        node.status({ fill: "red", shape: "ring", text: "stopped" });
      }
    }

    // -------------------------------------------------------------------------
    // Timer elapsed handler
    // -------------------------------------------------------------------------

    function timerElapsed(msg) {
      if (actualDelayRemaining === 0) {
        clearInterval(countdown);
        timerRunning = false;
        timerState   = TIMER_STATE.EXPIRED;
        delayRemainingDisplay = 0;  // Ensure remainingTime is correctly 0 on expiry
        stopHeartbeat();
        node.status(buildStatus(null, TIMER_STATE.EXPIRED));

        if (stopped === false) {
          let msg2           = RED.util.cloneMessage(msg);
          msg2.payload       = node.payloadval;
          msg2.timerState    = timerState;
          msg2.timerDuration = timerDuration;
          msg2.elapsedTime   = getElapsedTime();
          msg.timerState     = timerState;
          msg.timerDuration  = timerDuration;
          msg.elapsedTime    = getElapsedTime();

          let msg3 = reporting === REPORTING.NONE ? null : {
            payload:       displayTime(0, reportingformat),
            timerState:    timerState,
            remainingTime: 0,
            timerDuration: timerDuration,
            elapsedTime:   getElapsedTime()
          };

          deleteState();
          ignoredCount    = 0;
          lastIgnoredTime = null;

          node.send([msg, msg2, msg3, null, buildEventMessage(TIMER_EVENT.EXPIRED)]);
          return;
        }
        timeout     = null;
        countdown   = null;
        miniTimeout = null;
      } else if (actualDelayRemaining > maxTimeout) {
        actualDelayInUse      = maxTimeout;
        actualDelayRemaining -= maxTimeout;
      } else {
        actualDelayInUse     = actualDelayRemaining;
        actualDelayRemaining = 0;
      }
      timeout = setTimeout(timerElapsed, actualDelayInUse, msg);
    }

    // -------------------------------------------------------------------------
    // Display time formatter
    // -------------------------------------------------------------------------

    function displayTime(delayToDisplay, reportingformat) {
      delayToDisplay = delayToDisplay / 1000;
      switch (reportingformat) {
        case REPORTING_FORMAT.SECONDS: return delayToDisplay;
        case REPORTING_FORMAT.MINUTES: return delayToDisplay / 60;
        case REPORTING_FORMAT.HOURS:   return delayToDisplay / 3600;
        default:
          let hours   = String(Math.floor(delayToDisplay / 3600)).padStart(2, "0");
          delayToDisplay %= 3600;
          let minutes = String(Math.floor(delayToDisplay / 60)).padStart(2, "0");
          let seconds = String(delayToDisplay % 60).padStart(2, "0");
          return hours + ":" + minutes + ":" + seconds;
      }
    }

    // -------------------------------------------------------------------------
    // Persist helpers
    // -------------------------------------------------------------------------

    function writeState(msg) {
      if (node.persist !== true) return;
      try {
        if (!fs.existsSync(path.dirname(stvdtimersFile))) {
          fs.mkdirSync(path.dirname(stvdtimersFile), { recursive: true });
        }
        let target = (new Date((new Date().getTime() + delayRemainingDisplay))).toISOString();
        fs.writeFileSync(stvdtimersFile, JSON.stringify(JSON.decycle({
          reporting:        node.reporting,
          reportingformat:  node.reportingformat,
          time:             target,
          origmsg:          msg !== null ? msg : {},
          paused:           paused,
          timerDuration:    timerDuration,
          timerStartTime:   timerStartTime ? timerStartTime.toISOString() : null,
          timerState:       timerState,
          ignoredCount:     ignoredCount,
          lastIgnoredTime:  lastIgnoredTime ? lastIgnoredTime.toISOString() : null,
          donotresettimer:  node.donotresettimer,
          overrideDuration: overrideDuration,
          disabled:         disabled
        })));
      } catch (error) {
        node.error("Error writing persistent file for stoptimer-varidelay node " + node.id.toString() + "\n\n" + error.toString());
      }
    }

    function readState() {
      try {
        let contents = fs.readFileSync(stvdtimersFile).toString();
        if (typeof contents !== 'undefined') return contents;
      } catch (error) {
        node.error("Error reading persistent file for stoptimer-varidelay node " + node.id.toString() + "\n\n" + error.toString());
      }
      return -1;
    }

    function deleteState() {
      try {
        if (fs.existsSync(stvdtimersFile)) fs.unlinkSync(stvdtimersFile);
      } catch (error) {
        node.error("Error deleting persistent file for stoptimer-varidelay node " + node.id.toString() + "\n\n" + error.toString());
      }
    }
  }

  RED.nodes.registerType("stoptimer-varidelay-plus", StopTimerVariDelay);
}