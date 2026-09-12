import React, { useState, useEffect } from 'react';
import { testingHarnessService } from '../../services/harness/testingHarnessService';
import { HarnessTestSuite, HarnessTestReport } from '../../types';
import { downloadBlob } from '../../utils/download';

export const TestingHarnessPanel: React.FC = () => {
  const [suites, setSuites] = useState<HarnessTestSuite[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [lastReport, setLastReport] = useState<HarnessTestReport | null>(null);
  const [expandedSuiteId, setExpandedSuiteId] = useState<string | null>('suite_cli');

  useEffect(() => {
    const update = () => {
      setSuites(testingHarnessService.getSuites());
      setIsRunning(testingHarnessService.getIsRunning());
      setLastReport(testingHarnessService.getLastReport());
    };
    update();
    return testingHarnessService.subscribe(update);
  }, []);

  const handleRunAll = async () => {
    await testingHarnessService.runAllSuites();
  };

  const handleExportReport = () => {
    if (!lastReport) return;
    const md = `# Luminara Archy Acceptance Test Report
**Run Timestamp:** ${new Date(lastReport.timestamp).toISOString()}
**Summary:** ${lastReport.passed} Passed / ${lastReport.failed} Failed (Total: ${lastReport.totalTests} tests across ${lastReport.totalSuites} suites)
**Total Execution Time:** ${(lastReport.durationMs / 1000).toFixed(2)}s

---

${lastReport.suites.map(s => `## [${s.status.toUpperCase()}] ${s.name} (${s.durationMs}ms)
${s.description}

| Test Case | Status | Duration |
| :--- | :--- | :--- |
${s.testCases.map(tc => `| ${tc.name} | ${tc.status.toUpperCase()} | ${tc.durationMs}ms |`).join('\n')}
`).join('\n')}
`;

    downloadBlob(md, `acceptance-report-${Date.now()}.md`, 'text/markdown');
  };

  const totalTests = suites.reduce((acc, s) => acc + s.testCases.length, 0);
  const passedTests = suites.reduce((acc, s) => acc + s.testCases.filter(tc => tc.status === 'passed').length, 0);
  const failedTests = suites.reduce((acc, s) => acc + s.testCases.filter(tc => tc.status === 'failed').length, 0);
  const progressPct = totalTests > 0 ? (passedTests + failedTests) / totalTests * 100 : 0;

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Top Banner */}
      <div className="glass-morphism rounded-2xl border border-gold/30 p-6 bg-black/60 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <span className="text-[10px] font-mono uppercase tracking-[0.3em] px-2.5 py-0.5 rounded-full bg-gold/20 text-gold-light border border-gold/40 font-black">
            ACCEPTANCE TESTBED
          </span>
          <h2 className="text-2xl font-bold gold-text tracking-tight mt-2">
            Automated Acceptance & Verification Harness
          </h2>
          <p className="text-gray-400 text-xs mt-1 max-w-2xl">
            Inspired by Omarchy's comprehensive acceptance and CLI test suite (<code>test/all</code>, <code>test/cli</code>). Runs continuous verification on CLI metadata, multi-agent fleet dispatch, OracleMind SLM tensors, TimesFM models, and SERP schema parsing.
          </p>
        </div>

        <div className="flex items-center gap-3">
          {lastReport && (
            <button
              onClick={handleExportReport}
              className="px-3 py-2 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-xs font-mono text-gray-300 hover:text-white transition-all"
            >
              Export Report
            </button>
          )}

          <button
            onClick={handleRunAll}
            disabled={isRunning}
            className="px-5 py-2.5 rounded-xl bg-gold hover:bg-gold-dark text-black font-bold text-xs uppercase tracking-widest transition-all disabled:opacity-50 flex items-center gap-2 shadow-lg shadow-gold/20"
          >
            {isRunning ? (
              <>
                <div className="w-3.5 h-3.5 border-2 border-black border-t-transparent rounded-full animate-spin" />
                <span>Testing Suites...</span>
              </>
            ) : (
              <>
                <span>Run Acceptance Suite</span>
                <span>▶</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Progress & Stat Counters */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="glass-morphism rounded-xl border border-white/5 p-4 bg-black/40">
          <div className="text-[10px] font-mono text-gray-400 uppercase">Test Suites</div>
          <div className="text-xl font-bold text-white font-mono mt-1">{suites.length} Suites</div>
          <div className="text-[10px] text-gray-500 font-mono mt-0.5">{totalTests} individual assertions</div>
        </div>

        <div className="glass-morphism rounded-xl border border-white/5 p-4 bg-black/40">
          <div className="text-[10px] font-mono text-gray-400 uppercase">Passed Specs</div>
          <div className="text-xl font-bold text-success-400 font-mono mt-1">{passedTests} Passed</div>
          <div className="text-[10px] text-gray-500 font-mono mt-0.5">100% target pass rate</div>
        </div>

        <div className="glass-morphism rounded-xl border border-white/5 p-4 bg-black/40">
          <div className="text-[10px] font-mono text-gray-400 uppercase">Failures</div>
          <div className="text-xl font-bold text-danger-400 font-mono mt-1">{failedTests} Failed</div>
          <div className="text-[10px] text-gray-500 font-mono mt-0.5">Automated trap detection</div>
        </div>

        <div className="glass-morphism rounded-xl border border-white/5 p-4 bg-black/40">
          <div className="text-[10px] font-mono text-gray-400 uppercase">Suite Execution Time</div>
          <div className="text-xl font-bold text-gold-light font-mono mt-1">
            {lastReport ? `${(lastReport.durationMs / 1000).toFixed(2)}s` : '0.00s'}
          </div>
          <div className="text-[10px] text-gray-500 font-mono mt-0.5">Real-time benchmark</div>
        </div>
      </div>

      {/* Live Progress Bar */}
      {isRunning && (
        <div className="space-y-1.5 p-4 rounded-xl glass-morphism border border-gold/30 bg-black/70">
          <div className="flex items-center justify-between text-xs font-mono text-gray-300">
            <span>Running Acceptance Verification Pipeline...</span>
            <span className="text-gold-light font-bold">{progressPct.toFixed(0)}%</span>
          </div>
          <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-gold to-success-400 transition-all duration-300 rounded-full"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      )}

      {/* Suites Accordion / Details */}
      <div className="space-y-4">
        {suites.map(suite => {
          const isExpanded = expandedSuiteId === suite.id;
          return (
            <div
              key={suite.id}
              className="glass-morphism rounded-2xl border border-white/10 bg-black/60 overflow-hidden transition-all"
            >
              {/* Suite Header */}
              <div
                onClick={() => setExpandedSuiteId(isExpanded ? null : suite.id)}
                className="p-4 flex items-center justify-between cursor-pointer hover:bg-white/[0.02] transition-colors border-b border-white/5"
              >
                <div className="flex items-center gap-3">
                  <span
                    className={`w-2.5 h-2.5 rounded-full ${
                      suite.status === 'passed'
                        ? 'bg-success-400 shadow-[0_0_8px_#10B981]'
                        : suite.status === 'failed'
                        ? 'bg-danger-400'
                        : suite.status === 'running'
                        ? 'bg-warning-400 animate-pulse'
                        : 'bg-gray-600'
                    }`}
                  />
                  <div>
                    <div className="text-sm font-bold text-white flex items-center gap-2">
                      <span>{suite.name}</span>
                      <span className="text-[9px] font-mono px-2 py-0.5 rounded bg-white/5 text-gray-400 uppercase">
                        {suite.category}
                      </span>
                    </div>
                    <div className="text-xs text-gray-400 mt-0.5">{suite.description}</div>
                  </div>
                </div>

                <div className="flex items-center gap-4">
                  <span className="text-xs font-mono text-gray-400">
                    {suite.durationMs ? `${suite.durationMs}ms` : ''}
                  </span>
                  <span
                    className={`text-[10px] font-mono uppercase px-2.5 py-1 rounded-full font-bold border ${
                      suite.status === 'passed'
                        ? 'bg-success-500/20 text-success-400 border-success-500/30'
                        : suite.status === 'failed'
                        ? 'bg-danger-500/20 text-danger-400 border-danger-500/30'
                        : suite.status === 'running'
                        ? 'bg-warning-500/20 text-warning-400 border-warning-500/30'
                        : 'bg-white/5 text-gray-400 border-white/10'
                    }`}
                  >
                    {suite.status}
                  </span>
                </div>
              </div>

              {/* Test Cases List */}
              {isExpanded && (
                <div className="p-4 space-y-3 bg-black/40">
                  {suite.testCases.map(tc => (
                    <div
                      key={tc.id}
                      className="p-3 rounded-xl border border-white/5 bg-white/[0.01] space-y-2"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${
                              tc.status === 'passed'
                                ? 'bg-success-400'
                                : tc.status === 'failed'
                                ? 'bg-danger-400'
                                : tc.status === 'running'
                                ? 'bg-warning-400 animate-pulse'
                                : 'bg-gray-600'
                            }`}
                          />
                          <span className="text-xs font-bold text-gray-200">{tc.name}</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-[10px] font-mono text-gray-500">
                            {tc.durationMs ? `${tc.durationMs}ms` : ''}
                          </span>
                          <span
                            className={`text-[9px] font-mono uppercase px-2 py-0.5 rounded font-bold ${
                              tc.status === 'passed'
                                ? 'text-success-400 bg-success-500/10'
                                : tc.status === 'failed'
                                ? 'text-danger-400 bg-danger-500/10'
                                : tc.status === 'running'
                                ? 'text-warning-400 bg-warning-500/10'
                                : 'text-gray-500 bg-white/5'
                            }`}
                          >
                            {tc.status}
                          </span>
                        </div>
                      </div>

                      <div className="text-[11px] text-gray-400 font-mono">
                        {tc.description}
                      </div>

                      {tc.logs && tc.logs.length > 0 && (
                        <div className="p-2.5 rounded-lg bg-black/60 border border-white/5 font-mono text-[10px] text-gray-400 space-y-0.5">
                          {tc.logs.map((log, lidx) => (
                            <div key={lidx} className="flex items-start gap-1.5">
                              <span className="text-gold">›</span>
                              <span>{log}</span>
                            </div>
                          ))}
                        </div>
                      )}

                      {tc.error && (
                        <div className="p-2.5 rounded-lg bg-danger-500/10 border border-danger-500/20 font-mono text-[10px] text-danger-300">
                          Error: {tc.error}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
