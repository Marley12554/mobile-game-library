const canvas = document.getElementById('game') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
canvas.width = innerWidth; canvas.height = innerHeight;
ctx.fillStyle = '#fff'; ctx.font = '24px sans-serif'; ctx.fillText('Coming soon', 20, 40);
