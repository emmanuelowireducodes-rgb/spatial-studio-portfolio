import{create}from'zustand';type State={view:string;setView:(v:string)=>void};export const useExperience=create<State>(set=>({view:'home',setView:view=>set({view})}));
type EnvironmentState={mode:'day'|'night';toggle:()=>void};export const useEnvironment=create<EnvironmentState>(set=>({mode:'night',toggle:()=>set(s=>({mode:s.mode==='night'?'day':'night'}))}));
