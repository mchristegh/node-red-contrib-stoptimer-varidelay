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
 **/

module.exports = function(RED) {
  "use strict";
  function StopTimerVariDelay(n) {
    RED.nodes.createNode(this, n);
    let fs = require('fs');
    let path = require('path');
    let nodefile = n.id.toString();
    let nodepath = "";
    require('./cycle.js');
    
    if (n._alias != null) {
      nodepath = n._flow.path.replace(/\//g, "-") + "-";
      nodefile = n._alias;
    }

    const stvdtimersFile = path.join(RED.settings.userDir, "stvd-timers", nodepath + nodefile);

    this.units = n.units || "Second";
    this.durationType = n.durationType;
    this.duration = isNaN(Number(RED.util.evaluateNodeProperty(n.duration, this.durationType, this, null))) ? 5 : Number(RED.util.evaluateNodeProperty(n.duration, this.durationType, this, null));
    this.payloadval = n.payloadval || "0";
    this.payloadtype = n.payloadtype || "num";
    this.reporting = n.reporting || "none";
    this.reportingformat = n.reportingformat || "human";
    this.persist = n.persist || false;
    this.ignoretimerpass = n.ignoretimerpass || false;
    this.donotresettimer = n.donotresettimer || false;
    this.thresholdaction = n.thresholdaction || "donothing";
    this.thresholdcount = isNaN(Number(n.thresholdcount)) ? 0 : Number(n.thresholdcount);
    this.thresholdaddtime = isNaN(Number(n.thresholdaddtime)) ? 0 : Number(n.thresholdaddtime);
    this.thresholdaddtimeunits = n.thresholdaddtimeunits || "Second";

    if (this.duration <= 0) {
        this.duration = 0;
    } else {
      if (this.units == "Second") {
          this.duration = this.duration * 1000;
      }
      if (this.units == "Minute") {
          this.duration = this.duration * 1000 * 60;
      }
      if (this.units == "Hour") {
          this.duration = this.duration * 1000 * 60 * 60;
      }
    }

    if ((this.payloadtype === "num") && (!isNaN(this.payloadval))) {
      this.payloadval = Number(this.payloadval);
    } else if (this.payloadval === 'true' || this.payloadval === 'false') {
      let bValue = false;
      if (this.payloadval === 'true') {
        bValue = true;
      }
      this.payloadval = bValue;
    } else if (this.payloadval == "null") {
      this.payloadtype = 'null';
      this.payloadval = null;
    } else {
      this.payloadval = String(this.payloadval);
    }

    let node = this;

    let timeout = null;
    let miniTimeout = null; 
    let countdown = null;
    let stopped = false;
    let paused = false;
    let delayRemainingDisplay = 0;
    let delayFactor = 1000;
    let reporting = this.reporting;
    let reportingformat = this.reportingformat;

    const maxTimeout = 2147483647;
    let actualDelayInUse = 0;
    let actualDelayRemaining = 0;

    let ignoredCount = 0;
    let lastIgnoredTime = null;
    let timerRunning = false;
    let timerState = "stopped";
    let timerStartTime = null;
    let timerDuration = 0;
    let originalMsg = null;

    // Read the state from a persistent file
    if (this.persist == true) {
      try {
        if (fs.existsSync(stvdtimersFile)) {
          let savedState = JSON.retrocycle(JSON.parse(readState()));
          let targetMS = (new Date(savedState.time.toString())).getTime();
          let nowMS = (new Date).getTime();
          this.reporting = savedState.reporting.toString();
          if (typeof savedState.reportingformat !== 'undefined') {
            this.reportingformat = savedState.reportingformat.toString();
          } else {
            this.reportingformat = "human";
          }

          if (typeof savedState.ignoredCount !== 'undefined') {
            ignoredCount = savedState.ignoredCount;
          }
          if (typeof savedState.lastIgnoredTime !== 'undefined' && savedState.lastIgnoredTime !== null) {
            lastIgnoredTime = new Date(savedState.lastIgnoredTime);
          }
          if (typeof savedState.timerStartTime !== 'undefined' && savedState.timerStartTime !== null) {
            timerStartTime = new Date(savedState.timerStartTime);
          }
          if (typeof savedState.timerState !== 'undefined') {
            timerState = savedState.timerState;
          }

          if (savedState.paused === true) {
            let remainingMS = targetMS - nowMS;
            if (remainingMS <= 0) {
              remainingMS = (Math.floor((Math.random() * 5) + 3) * 1000);
            }
            delayRemainingDisplay = remainingMS;
            timerDuration = typeof savedState.timerDuration !== 'undefined' ? savedState.timerDuration : remainingMS;
            timerStartTime = new Date(nowMS - (timerDuration - remainingMS));
            paused = true;
            timerRunning = false;
            timerState = "paused";
            let statusObj = buildStatus(displayTime(delayRemainingDisplay, node.reportingformat), "paused");
            node.status(statusObj);
          } else {
            if ((targetMS - nowMS) <= 3000) {
              targetMS = (Math.floor((Math.random() * 5) + 3) * 1000);
            } else {
              targetMS = (Math.round((targetMS - nowMS) / 1000)) * 1000;
            }
            savedState.origmsg.units = "millisecond";
            savedState.origmsg.delay = targetMS;
            if (typeof savedState.timerDuration !== 'undefined') {
              timerDuration = savedState.timerDuration;
            }
            handleInputEvent(savedState.origmsg);
          }
        }
      } catch (error) {
        this.error("Error processing persistent file data for stoptimer-varidelay node " + n.id.toString() + "\n\n" + error.toString());
      }
    } else {
      deleteState();
    }

    this.on("input", function(msg) {
      handleInputEvent(msg);
    });

    this.on("close", function(removed, done) {
      if (timeout) {
        clearTimeout(timeout);
      }
      if (countdown) {
        clearInterval(countdown);
      }
      if (miniTimeout) {
        clearTimeout(miniTimeout);
      }
      node.status({});

      if (removed) {
        deleteState();
      }
      done();
    });

    function buildStatus(timeDisplay, state) {
      if (state === "stopped" || state === "expired") {
        if (node.donotresettimer) {
          let lastStr = lastIgnoredTime ? formatIgnoredTime(lastIgnoredTime) : "--";
          let stateLabel = state === "stopped" ? "Stopped" : "Expired";
          return { fill: state === "stopped" ? "red" : "blue", shape: "ring", text: stateLabel + " | Ignored: " + ignoredCount + ", Last: " + lastStr };
        } else {
          if (state === "stopped") {
            return { fill: "red", shape: "ring", text: "stopped" };
          } else {
            return { fill: "blue", shape: "square", text: "expired" };
          }
        }
      } else if (state === "paused") {
        if (node.donotresettimer) {
          let lastStr = lastIgnoredTime ? formatIgnoredTime(lastIgnoredTime) : "--";
          return { fill: "yellow", shape: "ring", text: "Paused: " + timeDisplay + " | Ignored: " + ignoredCount + ", Last: " + lastStr };
        } else {
          return { fill: "yellow", shape: "ring", text: "Paused: " + timeDisplay };
        }
      } else {
        if (node.donotresettimer) {
          let lastStr = lastIgnoredTime ? formatIgnoredTime(lastIgnoredTime) : "--";
          return { fill: "green", shape: "dot", text: "Remaining: " + timeDisplay + " | Ignored: " + ignoredCount + ", Last: " + lastStr };
        } else {
          return { fill: "green", shape: "dot", text: timeDisplay };
        }
      }
    }

    function formatIgnoredTime(date) {
      let months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
      let mon = months[date.getMonth()];
      let day = String(date.getDate()).padStart(2,"0");
      let hh = String(date.getHours()).padStart(2,"0");
      let mm = String(date.getMinutes()).padStart(2,"0");
      let ss = String(date.getSeconds()).padStart(2,"0");
      return mon + " " + day + " " + hh + ":" + mm + ":" + ss;
    }

    function getElapsedTime() {
      if (timerStartTime === null) return 0;
      return (new Date()).getTime() - timerStartTime.getTime();
    }

    function buildEventMessage(timerEvent) {
      return {
        timerEvent: timerEvent,
        timerState: timerState,
        remainingTime: delayRemainingDisplay,
        timerDuration: timerDuration,
        elapsedTime: getElapsedTime(),
        ignoredCount: ignoredCount,
        lastIgnoredTime: lastIgnoredTime ? lastIgnoredTime.toISOString() : null
      };
    }

    // Helper: start/restart the underlying setTimeout chain
    function startTimeout(msg) {
      actualDelayRemaining = delayRemainingDisplay;
      if (actualDelayRemaining > maxTimeout) {
        actualDelayInUse = maxTimeout;
        actualDelayRemaining = actualDelayRemaining - maxTimeout;
      } else {
        actualDelayInUse = actualDelayRemaining;
        actualDelayRemaining = 0;
      }
      timeout = setTimeout(timerElapsed, actualDelayInUse, msg);
    }

    // Helper: start/restart reporting intervals
    function startReporting(msg) {
      if (reporting === "none") {
        let statusObj = buildStatus(displayTime(delayRemainingDisplay, reportingformat), "running");
        node.status(statusObj);
        return;
      }

      let statusObj = buildStatus(displayTime(delayRemainingDisplay, reportingformat), "running");
      node.status(statusObj);
      let msg3 = { payload: displayTime(delayRemainingDisplay, reportingformat), timerState: timerState, remainingTime: delayRemainingDisplay, timerDuration: timerDuration, elapsedTime: getElapsedTime() };
      node.send([null, null, msg3, null, null]);

      if ((delayRemainingDisplay > 60000) && (reporting === "last_minute_seconds")) {
        miniTimeout = setTimeout(function() {
          if ((delayRemainingDisplay % 60000) != 0) {
            delayRemainingDisplay = delayRemainingDisplay - (delayRemainingDisplay % 60000);
            let msg3 = { payload: displayTime(delayRemainingDisplay, reportingformat), timerState: timerState, remainingTime: delayRemainingDisplay, timerDuration: timerDuration, elapsedTime: getElapsedTime() };
            let statusObj = buildStatus(displayTime(delayRemainingDisplay, reportingformat), "running");
            node.status(statusObj);
            node.send([null, null, msg3, null, null]);
          }

          if (delayRemainingDisplay <= 60000) {
            countdown = setInterval(function() {
              delayRemainingDisplay = delayRemainingDisplay - 1000;
              let msg3 = { payload: displayTime(delayRemainingDisplay, reportingformat), timerState: timerState, remainingTime: delayRemainingDisplay, timerDuration: timerDuration, elapsedTime: getElapsedTime() };
              let statusObj = buildStatus(displayTime(delayRemainingDisplay, reportingformat), "running");
              node.status(statusObj);
              node.send([null, null, msg3, null, null]);
            }, 1000);
          } else {
            countdown = setInterval(function() {
              if (delayRemainingDisplay > 60000) {
                delayRemainingDisplay = delayRemainingDisplay - 60000;
                let msg3 = { payload: displayTime(delayRemainingDisplay, reportingformat), timerState: timerState, remainingTime: delayRemainingDisplay, timerDuration: timerDuration, elapsedTime: getElapsedTime() };
                let statusObj = buildStatus(displayTime(delayRemainingDisplay, reportingformat), "running");
                node.status(statusObj);
                node.send([null, null, msg3, null, null]);
              }

              if (delayRemainingDisplay <= 60000) {
                clearInterval(countdown);
                countdown = null;
                countdown = setInterval(function() {
                  delayRemainingDisplay = delayRemainingDisplay - 1000;
                  let msg3 = { payload: displayTime(delayRemainingDisplay, reportingformat), timerState: timerState, remainingTime: delayRemainingDisplay, timerDuration: timerDuration, elapsedTime: getElapsedTime() };
                  let statusObj = buildStatus(displayTime(delayRemainingDisplay, reportingformat), "running");
                  node.status(statusObj);
                  node.send([null, null, msg3, null, null]);
                }, 1000);
              }
            }, 60000);
          }
          miniTimeout = null;
        }, delayRemainingDisplay % 60000);
      } else {
        countdown = setInterval(function() {
          delayRemainingDisplay = delayRemainingDisplay - 1000;
          let msg3 = { payload: displayTime(delayRemainingDisplay, reportingformat), timerState: timerState, remainingTime: delayRemainingDisplay, timerDuration: timerDuration, elapsedTime: getElapsedTime() };
          let statusObj = buildStatus(displayTime(delayRemainingDisplay, reportingformat), "running");
          node.status(statusObj);
          node.send([null, null, msg3, null, null]);
        }, 1000);
      }
    }

    // Helper: clear all active timers and intervals
    function clearAllTimers() {
      clearTimeout(timeout);
      clearTimeout(miniTimeout);
      clearInterval(countdown);
      timeout = null;
      countdown = null;
      miniTimeout = null;
    }

    function handleThresholdAction() {
      if (node.thresholdaction === "donothing" || node.thresholdcount <= 0) return;
      if (ignoredCount % node.thresholdcount !== 0) return;

      let msg5 = null;

      if (node.thresholdaction === "stop") {
        timerRunning = false;
        timerState = "stopped";
        stopped = true;
        clearAllTimers();
        deleteState();
        msg5 = buildEventMessage("threshold_stopped");
        ignoredCount = 0;
        lastIgnoredTime = null;
        let statusObj = buildStatus(null, "stopped");
        node.status(statusObj);
        node.send([null, null, null, null, msg5]);

      } else if (node.thresholdaction === "pause") {
        if (timerRunning) {
          timerRunning = false;
          timerState = "paused";
          paused = true;
          clearAllTimers();
          writeState(originalMsg);
          msg5 = buildEventMessage("threshold_paused");
          ignoredCount = 0;
          lastIgnoredTime = null;
          let statusObj = buildStatus(displayTime(delayRemainingDisplay, reportingformat), "paused");
          node.status(statusObj);
          node.send([null, null, null, null, msg5]);
        }

      } else if (node.thresholdaction === "reset") {
        clearAllTimers();
        delayRemainingDisplay = timerDuration;
        timerStartTime = new Date();
        timerState = "running";
        timerRunning = true;
        msg5 = buildEventMessage("threshold_reset");
        ignoredCount = 0;
        lastIgnoredTime = null;
        writeState(originalMsg);
        node.send([null, null, null, null, msg5]);
        startTimeout(originalMsg);
        startReporting(originalMsg);

      } else if (node.thresholdaction === "addtime") {
        let addTimeMS = node.thresholdaddtime;
        if (node.thresholdaddtimeunits === "Second") {
          addTimeMS = addTimeMS * 1000;
        } else if (node.thresholdaddtimeunits === "Minute") {
          addTimeMS = addTimeMS * 1000 * 60;
        } else if (node.thresholdaddtimeunits === "Hour") {
          addTimeMS = addTimeMS * 1000 * 60 * 60;
        }
        clearAllTimers();
        delayRemainingDisplay = delayRemainingDisplay + addTimeMS;
        timerState = "running";
        timerRunning = true;
        msg5 = buildEventMessage("threshold_time_added");
        msg5.timeAdded = addTimeMS;
        ignoredCount = 0;
        lastIgnoredTime = null;
        writeState(originalMsg);
        node.send([null, null, null, null, msg5]);
        startTimeout(originalMsg);
        startReporting(originalMsg);

      } else if (node.thresholdaction === "warning") {
        msg5 = buildEventMessage("threshold_warning");
        // Warning does not reset count or affect timer
        node.send([null, null, null, null, msg5]);
      }
    }

    function handleInputEvent(msg) {    
      node.status({});
      let delayUnits = node.units;
      reporting = node.reporting;

      // Handle query
      if (msg.payload == "query" || msg.payload == "QUERY") {
        let msg5 = buildEventMessage("query");
        let statusObj = buildStatus(displayTime(delayRemainingDisplay, reportingformat), timerState);
        node.status(statusObj);
        node.send([null, null, null, null, msg5]);
        return;
      }

      // Handle pause
      if (msg.payload == "pause" || msg.payload == "PAUSE") {
        if (paused) {
          let msg4 = RED.util.cloneMessage(msg);
          msg4.remainingTime = delayRemainingDisplay;
          msg4.timerState = timerState;
          msg4.ignoredCount = ignoredCount;
          msg4.lastIgnoredTime = lastIgnoredTime ? lastIgnoredTime.toISOString() : null;
          let statusObj = buildStatus(displayTime(delayRemainingDisplay, reportingformat), "paused");
          node.status(statusObj);
          node.send([null, null, null, msg4, null]);
          return;
        }
        if (timerRunning) {
          clearAllTimers();
          paused = true;
          timerRunning = false;
          timerState = "paused";
          writeState(originalMsg);
          let statusObj = buildStatus(displayTime(delayRemainingDisplay, reportingformat), "paused");
          node.status(statusObj);
          let msg2 = RED.util.cloneMessage(msg);
          msg2.payload = "paused";
          msg2.timerState = timerState;
          msg2.timerDuration = timerDuration;
          msg2.elapsedTime = getElapsedTime();
          let msg3 = { payload: displayTime(delayRemainingDisplay, reportingformat), timerState: timerState, remainingTime: delayRemainingDisplay, timerDuration: timerDuration, elapsedTime: getElapsedTime() };
          let msg5 = buildEventMessage("paused");
          node.send([null, msg2, msg3, null, msg5]);
        } else {
          let statusObj = buildStatus(displayTime(delayRemainingDisplay, reportingformat), timerState);
          node.status(statusObj);
        }
        return;
      }

      // Handle resume
      if (msg.payload == "resume" || msg.payload == "RESUME") {
        if (paused) {
          paused = false;
          timerRunning = true;
          timerState = "running";
          timerStartTime = new Date((new Date()).getTime() - (timerDuration - delayRemainingDisplay));
          writeState(originalMsg);
          let msg2 = RED.util.cloneMessage(msg);
          msg2.payload = "resumed";
          msg2.timerState = timerState;
          msg2.timerDuration = timerDuration;
          msg2.elapsedTime = getElapsedTime();
          let msg3 = { payload: displayTime(delayRemainingDisplay, reportingformat), timerState: timerState, remainingTime: delayRemainingDisplay, timerDuration: timerDuration, elapsedTime: getElapsedTime() };
          let msg5 = buildEventMessage("resumed");
          node.send([null, msg2, msg3, null, msg5]);
          startTimeout(originalMsg);
          startReporting(originalMsg);
        } else {
          let statusObj = buildStatus(displayTime(delayRemainingDisplay, reportingformat), timerState);
          node.status(statusObj);
        }
        return;
      }

      // While paused, any non-stop/resume message goes to output 4
      if (paused && msg.payload !== "stop" && msg.payload !== "STOP") {
        ignoredCount++;
        lastIgnoredTime = new Date();
        let statusObj = buildStatus(displayTime(delayRemainingDisplay, reportingformat), "paused");
        node.status(statusObj);
        let msg4 = RED.util.cloneMessage(msg);
        msg4.remainingTime = delayRemainingDisplay;
        msg4.timerState = timerState;
        msg4.ignoredCount = ignoredCount;
        msg4.lastIgnoredTime = lastIgnoredTime ? lastIgnoredTime.toISOString() : null;
        node.send([null, null, null, msg4, null]);
        handleThresholdAction();
        return;
      }

      if(stopped === false || msg._timerpass !== true || node.ignoretimerpass === true) {

        // If donotresettimer is on and the timer is already running, ignore the message
        if (node.donotresettimer && timerRunning && msg.payload !== "stop" && msg.payload !== "STOP" && msg._timerpass !== true) {
          ignoredCount++;
          lastIgnoredTime = new Date();
          let statusObj = buildStatus(displayTime(delayRemainingDisplay, reportingformat), "running");
          node.status(statusObj);
          let msg4 = RED.util.cloneMessage(msg);
          msg4.remainingTime = delayRemainingDisplay;
          msg4.timerState = timerState;
          msg4.ignoredCount = ignoredCount;
          msg4.lastIgnoredTime = lastIgnoredTime ? lastIgnoredTime.toISOString() : null;
          node.send([null, null, null, msg4, null]);
          handleThresholdAction();
          return;
        }

        stopped = false;
        paused = false;
        clearAllTimers();

        if (msg.payload == "stop" || msg.payload == "STOP") {
          timerRunning = false;
          timerState = "stopped";
          let statusObj = buildStatus(null, "stopped");
          node.status(statusObj);
          stopped = true;
          let msg2 = RED.util.cloneMessage(msg);
          msg2.payload = "stopped";
          msg2.timerState = timerState;
          msg2.timerDuration = timerDuration;
          msg2.elapsedTime = getElapsedTime();
          deleteState();
          ignoredCount = 0;
          lastIgnoredTime = null;
          node.send([null, msg2, msg2, null, null]);
        } else {
          msg._timerpass = true;
          if (msg.units != null) {
            if (msg.units.toLowerCase().includes("millisecond")) {
              delayUnits = "Millisecond";
            } else if (msg.units.toLowerCase().includes("second")) {
              delayUnits = "Second";
            } else if (msg.units.toLowerCase().includes("minute")) {
              delayUnits = "Minute";
            } else if (msg.units.toLowerCase().includes("hour")) {
              delayUnits = "Hour";
            } else {
              node.warn("Unknown units in message, using node default: " + delayUnits);
            }
          }

          if (delayUnits == "Second") {
            delayFactor = 1000;
          } else if (delayUnits == "Minute") {
            delayFactor = 1000 * 60;
          } else if (delayUnits == "Hour") {
            delayFactor = 1000 * 60 * 60;
          } else {
            delayFactor = 1;
          }

          if ((msg.delay != null) && (!isNaN(parseInt(msg.delay, 10)))) {
            delayRemainingDisplay = msg.delay * delayFactor;
          } else {
            delayRemainingDisplay = node.duration;
          }

          ignoredCount = 0;
          lastIgnoredTime = null;
          timerRunning = true;
          timerState = "running";
          timerStartTime = new Date();
          timerDuration = delayRemainingDisplay;
          originalMsg = msg;

          writeState(msg);
          let msg5 = buildEventMessage("started");
          node.send([null, null, null, null, msg5]);
          startTimeout(msg);
          startReporting(msg);
        }
      } else {
        node.status({ fill: "red", shape: "ring", text: "stopped" });
      }    
    }

    function timerElapsed(msg) {
      if (actualDelayRemaining == 0) {
        clearInterval(countdown);
        timerRunning = false;
        timerState = "expired";
        let statusObj = buildStatus(null, "expired");
        node.status(statusObj);
        
        if(stopped === false) {
          let msg2 = RED.util.cloneMessage(msg);
          let msg3 = { payload: displayTime(0, reportingformat), timerState: timerState, remainingTime: 0, timerDuration: timerDuration, elapsedTime: getElapsedTime() };
          msg2.payload = node.payloadval;
          msg2.timerState = timerState;
          msg2.timerDuration = timerDuration;
          msg2.elapsedTime = getElapsedTime();
          msg.timerState = timerState;
          msg.timerDuration = timerDuration;
          msg.elapsedTime = getElapsedTime();
          if (reporting == "none") {
            msg3 = null;
          }
          deleteState();
          ignoredCount = 0;
          lastIgnoredTime = null;
          node.send([msg, msg2, msg3, null, null]);
          return;
        }
        timeout = null;
        countdown = null;
        miniTimeout = null;
      } else if (actualDelayRemaining > maxTimeout) {
        actualDelayInUse = maxTimeout;
        actualDelayRemaining = actualDelayRemaining - maxTimeout;
      } else {
        actualDelayInUse = actualDelayRemaining;
        actualDelayRemaining = 0;
      }

      timeout = setTimeout(timerElapsed, actualDelayInUse, msg);
    }

    function displayTime(delayToDisplay, reportingformat) {
      let timeToDisplay = "";
      let hours, minutes, seconds;

      delayToDisplay = delayToDisplay / 1000;

      if (reportingformat == "seconds") {
        timeToDisplay = delayToDisplay;
      } else if (reportingformat == "minutes") {
        timeToDisplay = delayToDisplay / 60;
      } else if (reportingformat == "hours") {
        timeToDisplay = delayToDisplay / 3600;
      } else {
        hours = String(Math.floor(delayToDisplay / 3600)).padStart(2, "0");
        delayToDisplay %= 3600;
        minutes = String(Math.floor(delayToDisplay / 60)).padStart(2, "0");
        seconds = String(delayToDisplay % 60).padStart(2, "0");
        timeToDisplay = hours + ":" + minutes + ":" + seconds;
      }
      return timeToDisplay;
    }

    function writeState(msg) {
      if (node.persist == true) {
        try {
          if (!fs.existsSync(path.dirname(stvdtimersFile))) fs.mkdirSync(path.dirname(stvdtimersFile), { recursive: true });
          let target = (new Date((new Date().getTime() + delayRemainingDisplay))).toISOString();
          fs.writeFileSync(stvdtimersFile, JSON.stringify(JSON.decycle({ 
            reporting: node.reporting, 
            reportingformat: node.reportingformat, 
            time: target, 
            origmsg: msg !== null ? msg : {},
            paused: paused,
            timerDuration: timerDuration,
            timerStartTime: timerStartTime ? timerStartTime.toISOString() : null,
            timerState: timerState,
            ignoredCount: ignoredCount,
            lastIgnoredTime: lastIgnoredTime ? lastIgnoredTime.toISOString() : null
          })));
        } catch (error) {
          node.error("Error writing persistent file for stoptimer-varidelay node " + node.id.toString() + "\n\n" + error.toString());
        }
      }
    }

    function readState() {
      let retVal = -1;
      try {
        let contents = fs.readFileSync(stvdtimersFile).toString();
        if (typeof contents !== 'undefined') {
          retVal = contents;
        }
      } catch (error) {
        node.error("Error reading persistent file for stoptimer-varidelay node " + node.id.toString() + "\n\n" + error.toString());
      }
      return retVal;
    }

    function deleteState() {
      try {
        if (fs.existsSync(stvdtimersFile)) {
          fs.unlinkSync(stvdtimersFile);
        }
      } catch (error) {
        node.error("Error deleting persistent file for stoptimer-varidelay node " + node.id.toString() + "\n\n" + error.toString());
      }
    }
  }
  RED.nodes.registerType("stoptimer-varidelay-plus", StopTimerVariDelay);
}