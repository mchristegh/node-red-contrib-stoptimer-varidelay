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
 * ignored message handling, threshold actions, and rich output properties.
 **/

module.exports = function(RED) {
  "use strict";

  // ---------------------------------------------------------------------------
  // Module-level constants
  // ---------------------------------------------------------------------------

  /** Timer state values used in timerState variable and msg.timerState */
  const TIMER_STATE = {
    RUNNING: "running",
    PAUSED:  "paused",
    STOPPED: "stopped",
    EXPIRED: "expired"
  };

  /** Timer event values used in msg.timerEvent on output 5 */
  const TIMER_EVENT = {
    STARTED:              "started",
    PAUSED:               "paused",
    RESUMED:              "resumed",
    QUERY:                "query",
    LOCKED:               "locked",
    UNLOCKED:             "unlocked",
    TIMEADJUSTED:         "timeadjusted",
    TIMESET:              "timeset",
    DURATIONSET:          "durationset",
    THRESHOLD_STOPPED:    "threshold_stopped",
    THRESHOLD_PAUSED:     "threshold_paused",
    THRESHOLD_RESET:      "threshold_reset",
    THRESHOLD_TIME_ADDED: "threshold_time_added",
    THRESHOLD_WARNING:    "threshold_warning"
  };

  /**
   * Internal unit values as stored in the node configuration.
   * Used when comparing node config values and converting durations.
   */
  const UNITS = {
    MILLISECOND: "Millisecond",
    SECOND:      "Second",
    MINUTE:      "Minute",
    HOUR:        "Hour"
  };

  /**
   * Normalized unit values for comparing incoming msg.units.
   * All lowercase and singular — msg.units is normalized to this format
   * before comparison by lowercasing and stripping a trailing 's'.
   */
  const UNITS_INPUT = {
    MILLISECOND: "millisecond",
    SECOND:      "second",
    MINUTE:      "minute",
    HOUR:        "hour"
  };

  /** Threshold action values as stored in the node configuration */
  const THRESHOLD_ACTION = {
    DONOTHING: "donothing",
    STOP:      "stop",
    PAUSE:     "pause",
    RESET:     "reset",
    ADDTIME:   "addtime",
    WARNING:   "warning"
  };

  /**
   * Normalized payload command values (lowercase).
   * msg.payload is lowercased before comparison so these are case insensitive.
   */
  const PAYLOAD = {
    STOP:        "stop",
    PAUSE:       "pause",
    RESUME:      "resume",
    QUERY:       "query",
    LOCK:        "lock",
    UNLOCK:      "unlock",
    ADJUSTTIME:  "adjusttime",
    SETTIME:     "settime",
    SETDURATION: "setduration"
  };

  /** Reporting format values as stored in the node configuration */
  const REPORTING_FORMAT = {
    HUMAN:   "human",
    SECONDS: "seconds",
    MINUTES: "minutes",
    HOURS:   "hours"
  };

  /** Reporting frequency values as stored in the node configuration */
  const REPORTING = {
    NONE:                "none",
    EVERY_SECOND:        "every_second",
    LAST_MINUTE_SECONDS: "last_minute_seconds"
  };

  // ---------------------------------------------------------------------------
  // Node definition
  // ---------------------------------------------------------------------------

  /**
   * Main node constructor. Called by Node-RED for each node instance.
   * Initializes node properties, restores persisted state if enabled,
   * and registers input and close event handlers.
   *
   * @param {object} n - Node configuration object from Node-RED
   */
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

    // Convert the configured duration to milliseconds for internal use.
    if (this.duration <= 0) {
      this.duration = 0;
    } else {
      if (this.units === UNITS.SECOND) this.duration = this.duration * 1000;
      if (this.units === UNITS.MINUTE) this.duration = this.duration * 1000 * 60;
      if (this.units === UNITS.HOUR)   this.duration = this.duration * 1000 * 60 * 60;
    }

    // Coerce the configured payload value to the correct JavaScript type.
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
    let stopped               = false;
    let paused                = false;
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

    // overrideDuration — set by setduration command, used as duration for all
    // future runs until node is redeployed. null means use node.duration.
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

          if (typeof savedState.ignoredCount    !== 'undefined') ignoredCount    = savedState.ignoredCount;
          if (typeof savedState.lastIgnoredTime !== 'undefined' && savedState.lastIgnoredTime !== null) {
            lastIgnoredTime = new Date(savedState.lastIgnoredTime);
          }
          if (typeof savedState.timerStartTime !== 'undefined' && savedState.timerStartTime !== null) {
            timerStartTime = new Date(savedState.timerStartTime);
          }
          if (typeof savedState.timerState     !== 'undefined') timerState          = savedState.timerState;
          if (typeof savedState.donotresettimer !== 'undefined') node.donotresettimer = savedState.donotresettimer;
          if (typeof savedState.overrideDuration !== 'undefined' && savedState.overrideDuration !== null) {
            overrideDuration = savedState.overrideDuration;
          }

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
          } else {
            if ((targetMS - nowMS) <= 3000) {
              targetMS = (Math.floor((Math.random() * 5) + 3) * 1000);
            } else {
              targetMS = (Math.round((targetMS - nowMS) / 1000)) * 1000;
            }
            savedState.origmsg.units = UNITS_INPUT.MILLISECOND;
            savedState.origmsg.delay = targetMS;
            if (typeof savedState.timerDuration !== 'undefined') timerDuration = savedState.timerDuration;
            handleInputEvent(savedState.origmsg);
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
      handleInputEvent(msg);
    });

    this.on("close", function(removed, done) {
      if (timeout)     clearTimeout(timeout);
      if (countdown)   clearInterval(countdown);
      if (miniTimeout) clearTimeout(miniTimeout);
      node.status({});
      if (removed) deleteState();
      done();
    });

    // -------------------------------------------------------------------------
    // Status helper
    // -------------------------------------------------------------------------

    /**
     * Builds a Node-RED status object for the current timer state.
     *
     * @param {string|null} timeDisplay - Formatted time string or null
     * @param {string}      state       - One of the TIMER_STATE values
     * @returns {object} Node-RED status object
     */
    function buildStatus(timeDisplay, state) {
      if (state === TIMER_STATE.STOPPED || state === TIMER_STATE.EXPIRED) {
        if (node.donotresettimer) {
          let lastStr    = lastIgnoredTime ? formatIgnoredTime(lastIgnoredTime) : "--";
          let stateLabel = state === TIMER_STATE.STOPPED ? "Stopped" : "Expired";
          return {
            fill:  state === TIMER_STATE.STOPPED ? "red" : "blue",
            shape: "ring",
            text:  stateLabel + " | Ignored: " + ignoredCount + ", Last: " + lastStr
          };
        }
        return state === TIMER_STATE.STOPPED
          ? { fill: "red",  shape: "ring",   text: "stopped" }
          : { fill: "blue", shape: "square", text: "expired" };
      }

      if (state === TIMER_STATE.PAUSED) {
        if (node.donotresettimer) {
          let lastStr = lastIgnoredTime ? formatIgnoredTime(lastIgnoredTime) : "--";
          return { fill: "yellow", shape: "ring", text: "Paused: " + timeDisplay + " | Ignored: " + ignoredCount + ", Last: " + lastStr };
        }
        return { fill: "yellow", shape: "ring", text: "Paused: " + timeDisplay };
      }

      if (node.donotresettimer) {
        let lastStr = lastIgnoredTime ? formatIgnoredTime(lastIgnoredTime) : "--";
        return { fill: "green", shape: "dot", text: "Remaining: " + timeDisplay + " | Ignored: " + ignoredCount + ", Last: " + lastStr };
      }
      return { fill: "green", shape: "dot", text: timeDisplay };
    }

    // -------------------------------------------------------------------------
    // Utility helpers
    // -------------------------------------------------------------------------

    /**
     * Formats a Date object as "Mon DD HH:MM:SS" for display in node status.
     *
     * @param {Date} date - The date to format
     * @returns {string} Formatted date string e.g. "Jun 27 14:22:05"
     */
    function formatIgnoredTime(date) {
      const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
      return months[date.getMonth()]                    + " " +
             String(date.getDate()).padStart(2, "0")    + " " +
             String(date.getHours()).padStart(2, "0")   + ":" +
             String(date.getMinutes()).padStart(2, "0") + ":" +
             String(date.getSeconds()).padStart(2, "0");
    }

    /**
     * Returns the number of milliseconds elapsed since the timer started.
     *
     * @returns {number} Elapsed time in milliseconds
     */
    function getElapsedTime() {
      if (timerStartTime === null) return 0;
      return (new Date()).getTime() - timerStartTime.getTime();
    }

    /**
     * Converts a duration value to milliseconds based on the given units.
     *
     * @param {number} value - The duration value to convert
     * @param {string} units - One of the UNITS values
     * @returns {number} Duration in milliseconds
     */
    function convertToMilliseconds(value, units) {
      switch (units) {
        case UNITS.SECOND:      return value * 1000;
        case UNITS.MINUTE:      return value * 1000 * 60;
        case UNITS.HOUR:        return value * 1000 * 60 * 60;
        case UNITS.MILLISECOND: return value;
        default:                return value;
      }
    }

    /**
     * Normalizes a units string from an incoming message to a UNITS_INPUT value.
     * Lowercases and strips trailing 's' so both singular and plural forms work.
     *
     * @param {string} units - The units string to normalize
     * @returns {string} Normalized units string
     */
    function normalizeUnits(units) {
      return typeof units === 'string' ? units.toLowerCase().replace(/s$/, '') : null;
    }

    /**
     * Converts a message-provided value and optional units to milliseconds.
     * If units are not provided or not recognized, defaults to milliseconds.
     *
     * @param {number} value - The duration value
     * @param {string} units - Optional normalized units string
     * @returns {number} Duration in milliseconds
     */
    function msgValueToMs(value, units) {
      switch (units) {
        case UNITS_INPUT.SECOND: return value * 1000;
        case UNITS_INPUT.MINUTE: return value * 1000 * 60;
        case UNITS_INPUT.HOUR:   return value * 1000 * 60 * 60;
        default:                 return value; // milliseconds or unknown
      }
    }

    /**
     * Builds an output 5 event message with a full state snapshot.
     *
     * @param {string} timerEvent - One of the TIMER_EVENT values
     * @returns {object} Event message object ready to send on output 5
     */
    function buildEventMessage(timerEvent) {
      return {
        timerEvent:       timerEvent,
        timerState:       timerState,
        remainingTime:    delayRemainingDisplay,
        timerDuration:    timerDuration,
        elapsedTime:      getElapsedTime(),
        ignoredCount:     ignoredCount,
        lastIgnoredTime:  lastIgnoredTime ? lastIgnoredTime.toISOString() : null,
        doNotResetTimer:  node.donotresettimer
      };
    }

    // -------------------------------------------------------------------------
    // Timer management helpers
    // -------------------------------------------------------------------------

    /**
     * Clears all active timeouts and intervals.
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
     * Starts the main timer setTimeout chain from the current delayRemainingDisplay.
     * Handles durations longer than maxTimeout by chaining multiple setTimeout calls.
     *
     * @param {object} msg - The message to pass to timerElapsed when the timer fires
     */
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

    /**
     * Starts or restarts the reporting countdown intervals from the current
     * delayRemainingDisplay value.
     *
     * @param {object} msg - The original message (unused but kept for consistency)
     */
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

    /**
     * Evaluates whether the ignored message count has reached the configured
     * threshold and executes the configured action if so.
     */
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
          deleteState();
          msg5            = buildEventMessage(TIMER_EVENT.THRESHOLD_STOPPED);
          ignoredCount    = 0;
          lastIgnoredTime = null;
          node.status(buildStatus(null, TIMER_STATE.STOPPED));
          node.send([null, null, null, null, msg5]);
          break;

        case THRESHOLD_ACTION.PAUSE:
          if (timerRunning) {
            timerRunning    = false;
            timerState      = TIMER_STATE.PAUSED;
            paused          = true;
            clearAllTimers();
            writeState(originalMsg);
            msg5            = buildEventMessage(TIMER_EVENT.THRESHOLD_PAUSED);
            ignoredCount    = 0;
            lastIgnoredTime = null;
            node.status(buildStatus(displayTime(delayRemainingDisplay, reportingformat), TIMER_STATE.PAUSED));
            node.send([null, null, null, null, msg5]);
          }
          break;

        case THRESHOLD_ACTION.RESET:
          clearAllTimers();
          delayRemainingDisplay = timerDuration;
          timerStartTime        = new Date();
          msg5                  = buildEventMessage(TIMER_EVENT.THRESHOLD_RESET);
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

    /**
     * Main input handler. Called for every message received by the node.
     *
     * Processing order:
     * 1. query       — return state snapshot, no timer effect
     * 2. lock        — enable donotresettimer at runtime
     * 3. unlock      — disable donotresettimer at runtime
     * 4. adjusttime  — adjust remaining time (running/paused only)
     * 5. settime     — set remaining time to exact value (running/paused only)
     * 6. setduration — set duration for all future runs
     * 7. pause       — freeze the countdown
     * 8. resume      — restart from frozen point
     * 9. paused gate — non-stop messages go to output 4 while paused
     * 10. _timerpass gate — drop when stopped and _timerpass set
     * 11. donotresettimer gate — ignore while running if enabled
     * 12. stop       — cancel the timer
     * 13. default    — start or restart the timer
     *
     * @param {object} msg - The incoming Node-RED message
     */
    function handleInputEvent(msg) {
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
      // Adds or subtracts from the current remaining time.
      // Only works when running or paused. If result is <= 0, sets to 0.
      if (msgPayload === PAYLOAD.ADJUSTTIME) {
        if (timerRunning || paused) {
          let adjustUnits = normalizeUnits(msg.adjusttimeunits);
          let adjustMS    = msgValueToMs(msg.adjusttime, adjustUnits);
          delayRemainingDisplay = Math.max(0, delayRemainingDisplay + adjustMS);
          let msg5        = buildEventMessage(TIMER_EVENT.TIMEADJUSTED);
          msg5.timeAdjusted = adjustMS;
          writeState(originalMsg);
          if (paused) {
            // Stay paused, just update status
            node.status(buildStatus(displayTime(delayRemainingDisplay, reportingformat), TIMER_STATE.PAUSED));
          } else {
            // Restart timer from new remaining time
            clearAllTimers();
            startTimeout(originalMsg);
            startReporting(originalMsg);
          }
          node.send([null, null, null, null, msg5]);
        } else {
          // Not running or paused — ignore and restore status
          node.status(buildStatus(displayTime(delayRemainingDisplay, reportingformat), timerState));
        }
        return;
      }

      // -- Set Time --------------------------------------------------------
      // Sets the current remaining time to an exact value.
      // Only works when running or paused. Must be positive.
      if (msgPayload === PAYLOAD.SETTIME) {
        if (timerRunning || paused) {
          let setUnits = normalizeUnits(msg.settimeunits);
          let setMS    = msgValueToMs(msg.settime, setUnits);
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
            // Stay paused, just update status
            node.status(buildStatus(displayTime(delayRemainingDisplay, reportingformat), TIMER_STATE.PAUSED));
          } else {
            // Restart timer from new remaining time
            clearAllTimers();
            startTimeout(originalMsg);
            startReporting(originalMsg);
          }
          node.send([null, null, null, null, msg5]);
        } else {
          // Not running or paused — ignore and restore status
          node.status(buildStatus(displayTime(delayRemainingDisplay, reportingformat), timerState));
        }
        return;
      }

      // -- Set Duration ----------------------------------------------------
      // Sets node.duration for all future runs. Does not affect current run.
      // Works in all states. Must be positive.
      if (msgPayload === PAYLOAD.SETDURATION) {
        let durUnits  = normalizeUnits(msg.setdurationunits);
        let durMS     = msgValueToMs(msg.setduration, durUnits);
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
          let msg2           = RED.util.cloneMessage(msg);
          msg2.payload       = "stopped";
          msg2.timerState    = timerState;
          msg2.timerDuration = timerDuration;
          msg2.elapsedTime   = getElapsedTime();
          deleteState();
          ignoredCount    = 0;
          lastIgnoredTime = null;
          node.status(buildStatus(null, TIMER_STATE.STOPPED));
          node.send([null, msg2, msg2, null, null]);
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
          // Use overrideDuration if set, otherwise use node configured duration.
          // overrideDuration is cleared after use so it only applies once.
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

      } else {
        node.status({ fill: "red", shape: "ring", text: "stopped" });
      }
    }

    // -------------------------------------------------------------------------
    // Timer elapsed handler
    // -------------------------------------------------------------------------

    /**
     * Called when the main setTimeout fires.
     *
     * @param {object} msg - The original message that started the timer
     */
    function timerElapsed(msg) {
      if (actualDelayRemaining === 0) {
        clearInterval(countdown);
        timerRunning = false;
        timerState   = TIMER_STATE.EXPIRED;
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
          node.send([msg, msg2, msg3, null, null]);
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

    /**
     * Formats a remaining time value in milliseconds according to the
     * configured reporting format.
     *
     * @param {number} delayToDisplay  - Remaining time in milliseconds
     * @param {string} reportingformat - One of the REPORTING_FORMAT values
     * @returns {string|number} Formatted time
     */
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

    /**
     * Writes the current timer state to a persistent file on disk.
     *
     * @param {object|null} msg - The original message to persist, or null
     */
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
          overrideDuration: overrideDuration
        })));
      } catch (error) {
        node.error("Error writing persistent file for stoptimer-varidelay node " + node.id.toString() + "\n\n" + error.toString());
      }
    }

    /**
     * Reads the persistent state file from disk.
     *
     * @returns {string|number} File contents as a string, or -1 on error
     */
    function readState() {
      try {
        let contents = fs.readFileSync(stvdtimersFile).toString();
        if (typeof contents !== 'undefined') return contents;
      } catch (error) {
        node.error("Error reading persistent file for stoptimer-varidelay node " + node.id.toString() + "\n\n" + error.toString());
      }
      return -1;
    }

    /**
     * Deletes the persistent state file from disk if it exists.
     */
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
