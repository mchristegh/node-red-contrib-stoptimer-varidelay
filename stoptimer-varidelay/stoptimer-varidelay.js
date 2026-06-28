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
  // Defined once at module level so they are shared across all node instances
  // rather than recreated for each node.
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
    STOP:   "stop",
    PAUSE:  "pause",
    RESUME: "resume",
    QUERY:  "query"
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

    // Build the path to the persistent state file.
    // If the node is inside a subflow, incorporate the subflow path
    // into the filename to ensure uniqueness across subflow instances.
    if (n._alias != null) {
      nodepath = n._flow.path.replace(/\//g, "-") + "-";
      nodefile = n._alias;
    }

    const stvdtimersFile = path.join(RED.settings.userDir, "stvd-timers", nodepath + nodefile);

    // -------------------------------------------------------------------------
    // Node property initialization
    // Read configuration values from the node config object with safe defaults.
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
    // Millisecond durations are used as-is.
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
    // These track the current state of the timer and are updated as the
    // timer runs, pauses, stops, and expires.
    // -------------------------------------------------------------------------

    let timeout               = null;    // Main setTimeout handle
    let miniTimeout           = null;    // setTimeout handle for partial minute interval
    let countdown             = null;    // setInterval handle for reporting countdown
    let stopped               = false;   // True if timer was explicitly stopped
    let paused                = false;   // True if timer is currently paused
    let delayRemainingDisplay = 0;       // Current remaining time in milliseconds
    let delayFactor           = 1000;    // Multiplier to convert msg.delay to milliseconds
    let reporting             = this.reporting;
    let reportingformat       = this.reportingformat;

    /** Maximum duration for a single setTimeout call (~24.8 days in ms) */
    const maxTimeout = 2147483647;
    let actualDelayInUse      = 0;       // Duration of the current setTimeout call
    let actualDelayRemaining  = 0;       // Remaining time after current setTimeout

    let ignoredCount          = 0;       // Count of ignored messages in this timer run
    let lastIgnoredTime       = null;    // Date of the last ignored message
    let timerRunning          = false;   // True if timer is actively counting down
    let timerState            = TIMER_STATE.STOPPED; // Current timer state string
    let timerStartTime        = null;    // Date when the current timer run started
    let timerDuration         = 0;       // Original duration of the current timer run in ms
    let originalMsg           = null;    // The message that started the current timer run

    // -------------------------------------------------------------------------
    // Persist restore
    // If persistence is enabled and a state file exists, restore the timer
    // state from disk. This allows the timer to survive Node-RED restarts
    // and flow redeploys.
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

          // Restore ignored message tracking
          if (typeof savedState.ignoredCount    !== 'undefined') ignoredCount    = savedState.ignoredCount;
          if (typeof savedState.lastIgnoredTime !== 'undefined' && savedState.lastIgnoredTime !== null) {
            lastIgnoredTime = new Date(savedState.lastIgnoredTime);
          }

          // Restore timer start time for accurate elapsedTime after restart
          if (typeof savedState.timerStartTime !== 'undefined' && savedState.timerStartTime !== null) {
            timerStartTime = new Date(savedState.timerStartTime);
          }

          // Restore timer state string
          if (typeof savedState.timerState !== 'undefined') timerState = savedState.timerState;

          if (savedState.paused === true) {
            // Restore as paused — calculate remaining time and set paused state.
            // If remaining time is zero or negative, use a short random delay
            // to allow Node-RED to finish initializing before firing.
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
            // Restore as running — adjust remaining time to account for downtime.
            // If less than 3 seconds remain, use a random 3-8 second delay to
            // prevent all timers from firing simultaneously on restart and to
            // allow downstream nodes time to initialize.
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
      // Persistence is disabled — delete any leftover state file.
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
     * When donotresettimer is enabled, the status includes the ignored
     * message count and last ignored timestamp.
     *
     * @param {string|null} timeDisplay - Formatted time string or null for stopped/expired
     * @param {string}      state       - One of the TIMER_STATE values
     * @returns {object} Node-RED status object with fill, shape, and text properties
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

      // Running state
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
      return months[date.getMonth()]                          + " " +
             String(date.getDate()).padStart(2, "0")          + " " +
             String(date.getHours()).padStart(2, "0")         + ":" +
             String(date.getMinutes()).padStart(2, "0")       + ":" +
             String(date.getSeconds()).padStart(2, "0");
    }

    /**
     * Returns the number of milliseconds elapsed since the timer started.
     * Returns 0 if the timer has not been started.
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
     * Builds an output 5 event message with a full state snapshot.
     * All output 5 messages share this common set of properties.
     *
     * @param {string} timerEvent - One of the TIMER_EVENT values
     * @returns {object} Event message object ready to send on output 5
     */
    function buildEventMessage(timerEvent) {
      return {
        timerEvent:      timerEvent,
        timerState:      timerState,
        remainingTime:   delayRemainingDisplay,
        timerDuration:   timerDuration,
        elapsedTime:     getElapsedTime(),
        ignoredCount:    ignoredCount,
        lastIgnoredTime: lastIgnoredTime ? lastIgnoredTime.toISOString() : null
      };
    }

    // -------------------------------------------------------------------------
    // Timer management helpers
    // -------------------------------------------------------------------------

    /**
     * Clears all active timeouts and intervals.
     * Called whenever the timer needs to be stopped, paused, or restarted.
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
     * Handles durations longer than the JavaScript setTimeout maximum (~24.8 days)
     * by chaining multiple setTimeout calls.
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
     * delayRemainingDisplay value. Handles three reporting modes:
     * - NONE: updates status once, no interval
     * - EVERY_SECOND: updates every second
     * - LAST_MINUTE_SECONDS: updates every minute until the last minute,
     *   then switches to every second. Handles non-minute-increment durations
     *   by consuming the partial minute first via a miniTimeout.
     *
     * Also sends the initial time remaining message on output 3.
     *
     * @param {object} msg - The original message (unused but kept for consistency)
     */
    function startReporting(msg) {
      if (reporting === REPORTING.NONE) {
        node.status(buildStatus(displayTime(delayRemainingDisplay, reportingformat), TIMER_STATE.RUNNING));
        return;
      }

      // Send initial status and output 3 message
      node.status(buildStatus(displayTime(delayRemainingDisplay, reportingformat), TIMER_STATE.RUNNING));
      node.send([null, null, {
        payload:       displayTime(delayRemainingDisplay, reportingformat),
        timerState:    timerState,
        remainingTime: delayRemainingDisplay,
        timerDuration: timerDuration,
        elapsedTime:   getElapsedTime()
      }, null, null]);

      if ((delayRemainingDisplay > 60000) && (reporting === REPORTING.LAST_MINUTE_SECONDS)) {
        // Handle non-minute-increment durations by consuming the partial minute first,
        // then switch to normal minute intervals until the last minute,
        // then switch to second intervals.
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
            // Already in last minute — start second interval immediately
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
            // Start minute interval, switching to second interval in the last minute
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
                // Switch from minute to second interval for the last minute
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
        // EVERY_SECOND mode — simple 1 second interval
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
     *
     * The threshold fires every time ignoredCount is an exact multiple of
     * thresholdcount. After firing (except for WARNING and DONOTHING),
     * the ignored count resets to 0 so the threshold can fire again.
     *
     * Does nothing if thresholdaction is DONOTHING or thresholdcount is <= 0.
     * If the timer is paused, RESET and ADDTIME actions update the remaining
     * time but do not resume the timer — a resume message is required.
     */
    function handleThresholdAction() {
      if (node.thresholdaction === THRESHOLD_ACTION.DONOTHING || node.thresholdcount <= 0) return;
      if (ignoredCount % node.thresholdcount !== 0) return;

      let msg5 = null;

      switch (node.thresholdaction) {

        case THRESHOLD_ACTION.STOP:
          // Stop the timer completely
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
          // Pause the timer at the current remaining time.
          // Guard against pausing an already paused timer.
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
          // Reset the timer to the original duration.
          // If the timer is paused, keep it paused at the full duration —
          // do not resume until a resume message is received.
          // If the timer is running, restart it from the full duration.
          clearAllTimers();
          delayRemainingDisplay = timerDuration;
          timerStartTime        = new Date();
          msg5                  = buildEventMessage(TIMER_EVENT.THRESHOLD_RESET);
          ignoredCount          = 0;
          lastIgnoredTime       = null;
          writeState(originalMsg);
          node.send([null, null, null, null, msg5]);
          if (paused) {
            // Keep paused — just update status with new remaining time
            node.status(buildStatus(displayTime(delayRemainingDisplay, reportingformat), TIMER_STATE.PAUSED));
          } else {
            // Resume running from the full duration
            timerState   = TIMER_STATE.RUNNING;
            timerRunning = true;
            startTimeout(originalMsg);
            startReporting(originalMsg);
          }
          break;

        case THRESHOLD_ACTION.ADDTIME:
          // Add configured time to the remaining time.
          // If the timer is paused, keep it paused at the new remaining time —
          // do not resume until a resume message is received.
          // If the timer is running, restart it from the new remaining time.
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
            // Keep paused — just update status with new remaining time
            node.status(buildStatus(displayTime(delayRemainingDisplay, reportingformat), TIMER_STATE.PAUSED));
          } else {
            // Resume running from the new extended remaining time
            timerState   = TIMER_STATE.RUNNING;
            timerRunning = true;
            startTimeout(originalMsg);
            startReporting(originalMsg);
          }
          break;

        case THRESHOLD_ACTION.WARNING:
          // Send a warning on output 5 without affecting the timer or resetting the count
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
     * Normalizes msg.payload and msg.units to lowercase before comparison
     * to make all command matching case insensitive.
     *
     * Processing order:
     * 1. query   — return state snapshot on output 5, no timer effect
     * 2. pause   — freeze the countdown
     * 3. resume  — restart the countdown from the frozen point
     * 4. paused gate — while paused, non-stop messages go to output 4
     * 5. _timerpass gate — drop messages when stopped and _timerpass is set
     * 6. donotresettimer gate — ignore messages while running if enabled
     * 7. stop    — cancel the timer
     * 8. default — start or restart the timer
     *
     * @param {object} msg - The incoming Node-RED message
     */
    function handleInputEvent(msg) {
      node.status({});

      // Normalize msg.payload to lowercase for case-insensitive command matching.
      // Only normalize string payloads — numeric/boolean payloads pass through unchanged.
      const msgPayload = typeof msg.payload === 'string' ? msg.payload.toLowerCase() : msg.payload;

      // Normalize msg.units to lowercase singular for case-insensitive unit matching.
      // Strips trailing 's' so "seconds" and "second" both match UNITS_INPUT.SECOND.
      const msgUnits = typeof msg.units === 'string' ? msg.units.toLowerCase().replace(/s$/, '') : null;

      reporting       = node.reporting;
      reportingformat = node.reportingformat;

      // -- Query -----------------------------------------------------------
      // Return a full state snapshot on output 5 without affecting the timer.
      if (msgPayload === PAYLOAD.QUERY) {
        node.status(buildStatus(displayTime(delayRemainingDisplay, reportingformat), timerState));
        node.send([null, null, null, null, buildEventMessage(TIMER_EVENT.QUERY)]);
        return;
      }

      // -- Pause -----------------------------------------------------------
      // Freeze the countdown at the current remaining time.
      if (msgPayload === PAYLOAD.PAUSE) {
        if (paused) {
          // Already paused — route the duplicate pause to output 4
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
          // Timer not running — restore current status
          node.status(buildStatus(displayTime(delayRemainingDisplay, reportingformat), timerState));
        }
        return;
      }

      // -- Resume ----------------------------------------------------------
      // Restart the countdown from the frozen remaining time.
      if (msgPayload === PAYLOAD.RESUME) {
        if (paused) {
          paused         = false;
          timerRunning   = true;
          timerState     = TIMER_STATE.RUNNING;
          // Recalculate timerStartTime to account for the time spent paused
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
          // Not paused — restore current status
          node.status(buildStatus(displayTime(delayRemainingDisplay, reportingformat), timerState));
        }
        return;
      }

      // -- Paused gate -----------------------------------------------------
      // While paused, any non-stop message is routed to output 4.
      // The timer must be explicitly resumed — it cannot be restarted while paused.
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
      // Legacy behavior: if the timer was stopped and a message arrives with
      // _timerpass=true, drop it silently. This prevents timer expiry messages
      // from restarting a stopped timer in looped flows.
      // Can be disabled via the ignoretimerpass checkbox.
      if (stopped === false || msg._timerpass !== true || node.ignoretimerpass === true) {

        // -- donotresettimer gate ------------------------------------------
        // When enabled, ignore non-control messages while the timer is running.
        // Ignored messages are routed to output 4 with additional properties.
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
        // Cancel the timer and notify downstream nodes.
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
        // Start a new timer run. If the timer was already running,
        // clearAllTimers() above has cancelled it and this starts fresh.
        msg._timerpass = true;

        // Determine the delay factor (ms per unit) from msg.units or node config
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

        // Set the delay from msg.delay if provided, otherwise use node config duration
        if ((msg.delay != null) && (!isNaN(parseInt(msg.delay, 10)))) {
          delayRemainingDisplay = msg.delay * delayFactor;
        } else {
          delayRemainingDisplay = node.duration;
        }

        // Reset all tracking variables for the new timer run
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
        // _timerpass was set and timer is stopped and ignoretimerpass is off — drop the message
        node.status({ fill: "red", shape: "ring", text: "stopped" });
      }
    }

    // -------------------------------------------------------------------------
    // Timer elapsed handler
    // -------------------------------------------------------------------------

    /**
     * Called when the main setTimeout fires. If the full delay has elapsed,
     * sends the timer expiry messages on outputs 1, 2, and 3.
     * If the delay was longer than maxTimeout, chains another setTimeout
     * for the remaining time.
     *
     * @param {object} msg - The original message that started the timer
     */
    function timerElapsed(msg) {
      if (actualDelayRemaining === 0) {
        // Full delay has elapsed — fire the timer
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

          // Output 3 is null when reporting is NONE
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
        // Chain another maxTimeout setTimeout for very long delays
        actualDelayInUse      = maxTimeout;
        actualDelayRemaining -= maxTimeout;
      } else {
        // Final chained setTimeout for the remaining portion
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
     * @returns {string|number} Formatted time — string for HUMAN, number for others
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
     * Only writes if persistence is enabled in the node configuration.
     * Uses JSON.decycle to handle circular references in the original message.
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
          reporting:       node.reporting,
          reportingformat: node.reportingformat,
          time:            target,
          origmsg:         msg !== null ? msg : {},
          paused:          paused,
          timerDuration:   timerDuration,
          timerStartTime:  timerStartTime ? timerStartTime.toISOString() : null,
          timerState:      timerState,
          ignoredCount:    ignoredCount,
          lastIgnoredTime: lastIgnoredTime ? lastIgnoredTime.toISOString() : null
        })));
      } catch (error) {
        node.error("Error writing persistent file for stoptimer-varidelay node " + node.id.toString() + "\n\n" + error.toString());
      }
    }

    /**
     * Reads the persistent state file from disk and returns its contents as a string.
     * Returns -1 if the file cannot be read.
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
     * Called when the timer expires, is stopped, or the node is removed.
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
