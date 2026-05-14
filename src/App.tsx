import React, { useState } from 'react';
import { LabWorkbench } from './components/LabWorkbench.js';
import type { LabContext } from './components/LabWorkbench.js';
import { StrategyRoom } from './components/StrategyRoom.js';

export default function App() {
  const [labCtx, setLabCtx] = useState<LabContext | null>(null);

  return (
    <div className="app">
      <header className="app-header">
        <h1>Performance Prescription Engine</h1>
        <p>Critical Power · W′ · Race Strategy</p>
      </header>
      <main className="app-main">
        <LabWorkbench onLabUpdate={setLabCtx} />

        {labCtx && (
          <>
            <div className="pillar-divider">
              <span>Strategy Room</span>
            </div>
            <StrategyRoom
              cpWatts={labCtx.cpWatts}
              wPrimeJoules={labCtx.wPrimeJoules}
              weightKg={labCtx.weightKg}
              athleteId={labCtx.athleteId}
              apiKey={labCtx.apiKey}
              selectedEfforts={labCtx.selectedEfforts}
            />
          </>
        )}
      </main>
    </div>
  );
}
