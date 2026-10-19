import React from 'react';
import ReactDOM from 'react-dom/client';
import { WellcomeTimeline } from './components/WellcomeTimeline';
import rawMonetLetters from './monet_letters.json?raw';
import { parseTimelineJson } from './utils/julianDateConverter';

const defaultData = parseTimelineJson(rawMonetLetters);

const params = new URLSearchParams(window.location.search);
const customDataUri = params.get('dataUri');

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {customDataUri ? (
      <WellcomeTimeline dataUri={customDataUri} />
    ) : (
      <WellcomeTimeline data={defaultData} dataUri="monet_letters.json" />
    )}
  </React.StrictMode>,
);
