import './ui/styles.css';
import { App } from './ui/screens';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ui = document.getElementById('ui') as HTMLElement;
const hud = document.getElementById('hud') as HTMLElement;
// Wait for the display font so canvas text doesn't flash in a fallback.
const start = () => new App(canvas, ui, hud);
if (document.fonts?.load) document.fonts.load('700 20px Fredoka').then(start, start);
else start();
