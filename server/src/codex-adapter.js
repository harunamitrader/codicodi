import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { spawn } from "node:child_process";
import readline from "node:readline";

function buildArgs(config, threadId, sessionConfig, imagePaths = []) {
  const globalOptions = [];
  const execOptions = [];

  if (config.codexSearchEnabled) {
    globalOptions.push("--search");
  }

  if (
    config.codexBypassApprovalsAndSandbox &&
    !config.codexSandboxMode &&
    !config.codexApprovalPolicy
  ) {
    execOptions.push("--dangerously-bypass-approvals-and-sandbox");
  } else {
    if (config.codexApprovalPolicy) {
      globalOptions.push("-a", config.codexApprovalPolicy);
    }

    if (config.codexSandboxMode) {
      execOptions.push("-s", config.codexSandboxMode);
    }
  }

  if (sessionConfig.profile && sessionConfig.profile !== "default") {
    execOptions.push("-p", sessionConfig.profile);
  }

  if (sessionConfig.model) {
    execOptions.push("-m", sessionConfig.model);
  }

  if (sessionConfig.reasoningEffort) {
    execOptions.push("-c", `model_reasoning_effort="${sessionConfig.reasoningEffort}"`);
  }

  if (sessionConfig.serviceTier === "fast") {
    execOptions.push("-c", `service_tier="${sessionConfig.serviceTier}"`);
  }

  for (const imagePath of imagePaths) {
    if (imagePath) {
      execOptions.push("--image", imagePath);
    }
  }

  if (threadId) {
    return [...globalOptions, "exec", "resume", ...execOptions, "--json", threadId, "-"];
  }

  return [...globalOptions, "exec", ...execOptions, "--json", "-"];
}

function createCancelledError() {
  const error = new Error("Codex run cancelled by user.");
  error.name = "CodexRunCancelledError";
  error.cancelled = true;
  return error;
}

function ensureFile(logPath) {
  if (!logPath) {
    return;
  }

  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  if (!fs.existsSync(logPath)) {
    fs.writeFileSync(logPath, "", "utf8");
  }
}

function appendLines(logPath, lines = [], { timestamped = false } = {}) {
  if (!logPath || lines.length === 0) {
    return;
  }

  ensureFile(logPath);
  const normalizedLines = lines.map((line) => String(line ?? ""));
  const chunk = timestamped
    ? normalizedLines.map((line) => `[${new Date().toISOString()}] ${line}`).join("\n")
    : normalizedLines.join("\n");
  fs.appendFileSync(logPath, `${chunk}\n`, "utf8");
}

function appendTimestampedLines(logPath, lines = []) {
  appendLines(logPath, lines, { timestamped: true });
}

function appendPlainLines(logPath, lines = []) {
  appendLines(logPath, lines, { timestamped: false });
}

function formatConsoleBlock(label, text, continuationLabel = "  ") {
  const normalized = String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.split("\n");
  if (lines.length === 0) {
    return [label.trimEnd()];
  }

  return lines.map((line, index) => `${index === 0 ? label : continuationLabel}${line}`);
}

function formatElapsedSeconds(startedAt) {
  return Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
}

function formatUsageSummary(usage) {
  if (!usage) {
    return null;
  }

  const input = Number(usage.input_tokens || 0);
  const cached = Number(usage.cached_input_tokens ?? usage.input_tokens_details?.cached_tokens ?? 0);
  const output = Number(usage.output_tokens || 0);
  const reasoning = Number(usage.reasoning_tokens ?? usage.output_tokens_details?.reasoning_tokens ?? 0);
  const total = Number(usage.total_tokens || input + output);
  const inputPart = cached > 0 ? `input=${input.toLocaleString()} (+ ${cached.toLocaleString()} cached)` : `input=${input.toLocaleString()}`;
  const outputPart =
    reasoning > 0
      ? `output=${output.toLocaleString()} (reasoning ${reasoning.toLocaleString()})`
      : `output=${output.toLocaleString()}`;
  return `Token usage: total=${total.toLocaleString()} ${inputPart} ${outputPart}`;
}

function summarizePromptForConsole(prompt, maxLength = 280) {
  const lines = String(prompt || "").replace(/\r/g, "").split("\n");
  const visibleLines = [];
  let skipAttachmentList = false;

  for (const line of lines) {
    if (line === "Files:" || line === "Images attached:") {
      skipAttachmentList = true;
      continue;
    }

    if (skipAttachmentList) {
      if (line.startsWith("- ")) {
        continue;
      }

      if (!line.trim()) {
        skipAttachmentList = false;
        continue;
      }

      skipAttachmentList = false;
    }

    visibleLines.push(line.trimEnd());
  }

  const summary = visibleLines.join("\n").trim();
  if (!summary) {
    return "(attachment-only input)";
  }

  if (summary.length <= maxLength) {
    return summary;
  }

  return `${summary.slice(0, maxLength - 3)}...`;
}

function shortenPathForConsole(targetPath) {
  const normalizedPath = String(targetPath || "").replaceAll("/", "\\");
  const homeDirectory = os.homedir().replaceAll("/", "\\");
  if (homeDirectory && normalizedPath.toLowerCase().startsWith(homeDirectory.toLowerCase())) {
    return `~${normalizedPath.slice(homeDirectory.length)}`;
  }

  return normalizedPath;
}

function formatModelLine(sessionConfig) {
  const model = sessionConfig.model || "(default)";
  const reasoning = sessionConfig.reasoningEffort || null;
  const suffix = reasoning ? ` ${reasoning}` : "";
  const fastSuffix = sessionConfig.serviceTier === "fast" ? " fast" : "";
  return `${model}${suffix}${fastSuffix}`;
}

function formatRunIntroLines(sessionConfig, workdir, threadId, attachmentSummary) {
  const lines = [
    "",
    "OpenAI Codex",
    `model: ${formatModelLine(sessionConfig)}`,
    `directory: ${shortenPathForConsole(workdir)}`,
  ];

  if (threadId) {
    lines.push(`thread: resume ${threadId}`);
  }

  const attachmentText = formatAttachmentSummary(attachmentSummary);
  if (attachmentText) {
    lines.push(`attachments: ${attachmentText}`);
  }

  lines.push("");
  return lines;
}

function summarizeAttachments(prompt, imagePaths = []) {
  const lines = String(prompt || "").replace(/\r/g, "").split("\n");
  let fileCount = 0;
  let inFilesSection = false;

  for (const line of lines) {
    if (line === "Files:") {
      inFilesSection = true;
      continue;
    }

    if (!inFilesSection) {
      continue;
    }

    if (line.startsWith("- ")) {
      fileCount += 1;
      continue;
    }

    if (!line.trim()) {
      break;
    }

    break;
  }

  const imageCount = Array.isArray(imagePaths) ? imagePaths.filter(Boolean).length : 0;
  return { fileCount, imageCount };
}

function formatAttachmentSummary({ fileCount, imageCount }) {
  const parts = [];
  if (fileCount > 0) {
    parts.push(`${fileCount} file${fileCount === 1 ? "" : "s"}`);
  }
  if (imageCount > 0) {
    parts.push(`${imageCount} image${imageCount === 1 ? "" : "s"}`);
  }
  return parts.join(", ");
}

function extractErrorLines(stderrLines = []) {
  const normalized = stderrLines
    .map((line) => String(line || "").trim())
    .filter(Boolean);

  if (normalized.length <= 6) {
    return normalized;
  }

  return normalized.slice(-6);
}

export class CodexAdapter {
  constructor(config) {
    this.config = config;
    this.command = this.resolveCommand(config.codexCommand);
    this.workdir = config.codexWorkdir;
    this.developerMode = Boolean(config.codexDeveloperMode);
    this.developerLogPath = config.codexDeveloperLogPath;
    this.developerConsoleLogPath = config.codexDeveloperConsoleLogPath;
    this.developerConsoleProcess = null;
    this.runSequence = 0;
  }

  resolveCommand(command) {
    if (process.platform !== "win32") {
      return command;
    }

    const lowerName = path.basename(command).toLowerCase();
    if (lowerName === "codex" || lowerName === "codex.ps1") {
      return "codex.cmd";
    }

    return command;
  }

  resolveInvocation(threadId, sessionConfig, imagePaths = []) {
    const args = buildArgs(this.config, threadId, sessionConfig, imagePaths);
    if (process.platform === "win32") {
      return {
        command: "cmd.exe",
        args: ["/d", "/s", "/c", this.command, ...args],
      };
    }

    return {
      command: this.command,
      args,
    };
  }

  killChild(child) {
    if (!child.pid) {
      return;
    }

    if (process.platform === "win32") {
      const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
      });
      killer.unref();
      return;
    }

    child.kill("SIGTERM");
  }

  ensureDeveloperLogFile() {
    if (!this.developerMode) {
      return;
    }

    ensureFile(this.developerLogPath);
    ensureFile(this.developerConsoleLogPath);
  }

  appendDeveloperLog(lines = []) {
    if (!this.developerMode || lines.length === 0) {
      return;
    }

    appendTimestampedLines(this.developerLogPath, lines);
  }

  appendConsoleLog(lines = []) {
    if (!this.developerMode || lines.length === 0) {
      return;
    }

    appendPlainLines(this.developerConsoleLogPath, lines);
  }

  openDeveloperConsole(mode = "raw") {
    if (!this.developerMode) {
      return {
        ok: false,
        reason: "disabled",
        message: "Developer mode is disabled.",
      };
    }

    if (process.platform !== "win32") {
      return {
        ok: false,
        reason: "unsupported_platform",
        message: "Developer console is currently supported on Windows only.",
      };
    }

    this.ensureDeveloperLogFile();
    const normalizedMode = mode === "formatted" ? "formatted" : "raw";
    const selectedLogPath =
      normalizedMode === "formatted" ? this.developerConsoleLogPath : this.developerLogPath;
    const escapedSelectedLogPath = selectedLogPath.replace(/'/g, "''");
    const escapedConsoleLogPath = this.developerConsoleLogPath.replace(/'/g, "''");
    const escapedRawLogPath = this.developerLogPath.replace(/'/g, "''");

    if (normalizedMode === "formatted") {
      this.appendConsoleLog([
        "",
        "CoDiCoDi formatted console attached.",
        "Waiting for the next Codex CLI run...",
      ]);
    } else {
      this.appendDeveloperLog([
        "",
        "===== Developer console attached =====",
        `formatted log: ${this.developerConsoleLogPath}`,
        `raw log: ${this.developerLogPath}`,
        "Waiting for the next Codex CLI run...",
      ]);
    }

    const script = [
      "chcp 65001 > $null",
      "$utf8NoBom = New-Object System.Text.UTF8Encoding($false)",
      "$OutputEncoding = $utf8NoBom",
      "[Console]::InputEncoding = $utf8NoBom",
      "[Console]::OutputEncoding = $utf8NoBom",
      "$Host.UI.RawUI.WindowTitle = 'CoDiCoDi Developer Console'",
      `Write-Host 'CoDiCoDi ${normalizedMode === "formatted" ? "Formatted" : "Raw"} Console' -ForegroundColor Cyan`,
      `Write-Host 'Watching: ${escapedSelectedLogPath}' -ForegroundColor DarkGray`,
      "Write-Host ''",
      `Get-Content -Path '${escapedSelectedLogPath}' -Encoding UTF8 -Tail 120 -Wait`,
    ].join("; ");

    const child = spawn(
      "cmd.exe",
      [
        "/d",
        "/s",
        "/c",
        "start",
        "\"\"",
        "powershell.exe",
        "-NoLogo",
        "-NoExit",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        script,
      ],
      {
        cwd: this.workdir,
        detached: true,
        stdio: "ignore",
        windowsHide: false,
      },
    );
    child.unref();

    return {
      ok: true,
      reason: "opened",
      message: `Developer console opened (${normalizedMode}). Log: ${selectedLogPath}`,
    };
  }

  runTurn({ threadId, prompt, onEvent, sessionConfig, imagePaths = [] }) {
    const invocation = this.resolveInvocation(threadId, sessionConfig, imagePaths);
    const runId = ++this.runSequence;
    const runStartedAt = Date.now();
    const displayCommand = [invocation.command, ...invocation.args].join(" ");
    const attachmentSummary = summarizeAttachments(prompt, imagePaths);
    const promptSummary = summarizePromptForConsole(prompt);
    this.appendDeveloperLog([
      "",
      `===== Codex run #${runId} started =====`,
      `cwd: ${this.workdir}`,
      `command: ${displayCommand}`,
      `threadId: ${threadId || "(new thread)"}`,
      `model: ${sessionConfig.model || "(default)"}`,
      `reasoning: ${sessionConfig.reasoningEffort || "(default)"}`,
      `service_tier: ${sessionConfig.serviceTier || "(default)"}`,
      `profile: ${sessionConfig.profile || "default"}`,
      `images: ${imagePaths.length}`,
    ]);
    this.appendConsoleLog([
      ...formatRunIntroLines(sessionConfig, this.workdir, threadId, attachmentSummary),
      ...formatConsoleBlock("> ", promptSummary),
    ]);
    const child = spawn(invocation.command, invocation.args, {
      cwd: this.workdir,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let activeThreadId = threadId || null;
    const agentMessages = [];
    const rawEvents = [];
    const stderrLines = [];
    const consoleState = {
      lastStatus: null,
      pendingAssistantText: null,
      pendingUsage: null,
      didReceiveTurnCompleted: false,
    };
    let cancelRequested = false;
    let settled = false;

    const stdoutReader = readline.createInterface({ input: child.stdout });
    const stderrReader = readline.createInterface({ input: child.stderr });

    const appendConsoleStatus = (status) => {
      if (!status || consoleState.lastStatus === status) {
        return;
      }

      consoleState.lastStatus = status;
      if (status === "waiting for codex") {
        this.appendConsoleLog(["Thinking..."]);
      }
    };

    const flushPendingAssistant = (isFinal) => {
      if (!consoleState.pendingAssistantText) {
        return;
      }

        const label = isFinal ? "• " : "· ";
        this.appendConsoleLog(formatConsoleBlock(label, consoleState.pendingAssistantText));
        consoleState.pendingAssistantText = null;
      };

    const flushPendingUsage = () => {
      const usageLine = formatUsageSummary(consoleState.pendingUsage);
      if (!usageLine) {
        return;
      }

      this.appendConsoleLog([usageLine]);
      consoleState.pendingUsage = null;
    };

    const promise = new Promise((resolve, reject) => {
      function finalize(callback) {
        if (settled) {
          return;
        }

        settled = true;
        stdoutReader.close();
        stderrReader.close();
        callback();
      }

      stdoutReader.on("line", (line) => {
        const trimmed = line.trim();
        if (!trimmed) {
          return;
        }

        this.appendDeveloperLog([`[stdout] ${trimmed}`]);

        try {
          const event = JSON.parse(trimmed);
          rawEvents.push(event);

          if (event.type === "thread.started" && event.thread_id) {
            activeThreadId = event.thread_id;
            if (!threadId) {
              this.appendConsoleLog([`thread: ${event.thread_id}`]);
            }
          }

          if (
            event.type === "item.completed" &&
            event.item?.type === "agent_message" &&
            event.item?.text
          ) {
            agentMessages.push(event.item.text);
          }

          if (event.type === "turn.started") {
            appendConsoleStatus("waiting for codex");
          }

          if (
            event.type === "item.started" &&
            event.item?.type === "command_execution" &&
            event.item?.command
          ) {
            flushPendingAssistant(false);
            this.appendConsoleLog(formatConsoleBlock("Ran ", event.item.command));
          }

          if (
            event.type === "item.completed" &&
            event.item?.type === "agent_message" &&
            event.item?.text
          ) {
            flushPendingAssistant(false);
            consoleState.pendingAssistantText = event.item.text;
          }

          if (event.type === "turn.completed") {
            consoleState.didReceiveTurnCompleted = true;
            consoleState.pendingUsage = event.usage || null;
          }

          onEvent?.(event);
        } catch {
          stderrLines.push(`Unparsed stdout: ${trimmed}`);
        }
      });

      stderrReader.on("line", (line) => {
        if (line.trim()) {
          const trimmed = line.trim();
          stderrLines.push(trimmed);
          this.appendDeveloperLog([`[stderr] ${trimmed}`]);
        }
      });

      child.on("error", (error) => {
        this.appendDeveloperLog([
          `===== Codex run #${runId} process error =====`,
          error instanceof Error ? error.message : String(error),
        ]);
        this.appendConsoleLog([
          `Error: ${error instanceof Error ? error.message : String(error)}`,
          `Failed in ${formatElapsedSeconds(runStartedAt)}s.`,
        ]);
        finalize(() => reject(error));
      });

      child.on("close", (code) => {
        if (cancelRequested) {
          this.appendDeveloperLog([`===== Codex run #${runId} cancelled =====`]);
          flushPendingAssistant(false);
          this.appendConsoleLog([
            `Stopped after ${formatElapsedSeconds(runStartedAt)}s.`,
          ]);
          finalize(() => reject(createCancelledError()));
          return;
        }

        if (code !== 0) {
          flushPendingAssistant(consoleState.didReceiveTurnCompleted);
          flushPendingUsage();
          this.appendDeveloperLog([
            `===== Codex run #${runId} exited with code ${code} =====`,
            stderrLines.length ? stderrLines.join(" | ") : "(no stderr output)",
          ]);
          const errorLines = extractErrorLines(stderrLines);
          this.appendConsoleLog([
            `Error: Codex exited with code ${code}`,
            ...(errorLines.length > 0
              ? errorLines.flatMap((line, index) =>
                  formatConsoleBlock(index === 0 ? "stderr: " : "        ", line),
                )
              : ["stderr: (no stderr output)"]),
            `Failed in ${formatElapsedSeconds(runStartedAt)}s.`,
          ]);
          finalize(() =>
            reject(
              new Error(
                `Codex exited with code ${code}. ${stderrLines.join(" | ")}`.trim(),
              ),
            ),
          );
          return;
        }

        flushPendingAssistant(true);
        appendConsoleStatus("completed");
        flushPendingUsage();
        this.appendDeveloperLog([`===== Codex run #${runId} completed successfully =====`]);
        this.appendConsoleLog([
          `Completed in ${formatElapsedSeconds(runStartedAt)}s.`,
        ]);
        finalize(() =>
          resolve({
            threadId: activeThreadId,
            text: agentMessages.join("\n\n").trim(),
            rawEvents,
            stderrLines,
          }),
        );
      });

      child.stdin.write(prompt);
      child.stdin.end();
    });

    promise.cancel = () => {
      if (settled || cancelRequested) {
        return false;
      }

      cancelRequested = true;
      this.killChild(child);
      return true;
    };

    return promise;
  }
}
