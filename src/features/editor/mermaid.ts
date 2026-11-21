import mermaidUrl from '@mermaid-js/tiny/dist/mermaid.tiny.js?url';

type Mermaid = {
  initialize: (config: Record<string, unknown>) => void;
  render: (id: string, text: string) => Promise<{ svg: string }>;
};
let loading: Promise<Mermaid> | undefined;

// The official tiny distribution is a classic script. Bundle it locally rather
// than fetching a CDN asset, so diagrams also work offline inside Tauri.
export function loadMermaid(): Promise<Mermaid> {
  return loading ??= new Promise<Mermaid>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = mermaidUrl;
    script.onload = () => {
      const mermaid = (globalThis as typeof globalThis & { mermaid: Mermaid }).mermaid;
      if (!mermaid) { script.remove(); reject(new Error('Mermaid did not initialize')); return; }
      mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', suppressErrorRendering: true, theme: 'neutral', htmlLabels: false, look: 'classic', flowchart: { htmlLabels: false } });
      resolve(mermaid);
    };
    script.onerror = () => { script.remove(); reject(new Error('Mermaid could not load')); };
    document.head.append(script);
  }).catch(error => { loading = undefined; throw error; });
}
