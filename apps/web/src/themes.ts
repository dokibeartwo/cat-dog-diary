export const themes=[
  {id:'bg1',name:'星糖梦境',caption:'奶油黄 · 柔和紫',ink:'#2b2240',muted:'#665b72',paper:'#fff7d4',deep:'#f6e9bb',accent:'#ffd85c',secondary:'#7663cf',soft:'#ece5fc',dark:'#51416d'},
  {id:'bg2',name:'晴空蜜桃',caption:'浅晴蓝 · 蜜桃粉',ink:'#2d4057',muted:'#59627a',paper:'#f7fcff',deep:'#eaf7fb',accent:'#f39bac',secondary:'#72c9dc',soft:'#ffe1e8',dark:'#365872'},
  {id:'bg3',name:'莓果心动',caption:'奶油杏 · 莓果粉',ink:'#4a293b',muted:'#795865',paper:'#fff2df',deep:'#f6d7c2',accent:'#ffd569',secondary:'#e98baa',soft:'#ffe1e7',dark:'#873c57'},
  {id:'bg4',name:'奶杏布丁',caption:'奶杏色 · 玫瑰豆沙',ink:'#503a2e',muted:'#7c6659',paper:'#fff7e8',deep:'#f5e3c8',accent:'#ffd56f',secondary:'#c98fa3',soft:'#f9e5eb',dark:'#805548'},
  {id:'bg5',name:'青柠糖球',caption:'薄荷绿 · 柠檬黄',ink:'#31554e',muted:'#526e65',paper:'#f5fff9',deep:'#e0f3e8',accent:'#ffe58d',secondary:'#83cdb7',soft:'#e0f3e8',dark:'#3d6d60'},
  {id:'bg6',name:'蜜桃心语',caption:'蜜桃粉 · 浅薰衣草',ink:'#58333b',muted:'#84646a',paper:'#fff6f1',deep:'#f5dfd5',accent:'#ffd58a',secondary:'#b1a6d8',soft:'#eee8fb',dark:'#8a5069'}
];
export const themeOf=(id:string)=>themes.find(t=>t.id===id)||themes[0];
export function contrast(a:string,b:string){const luminance=(hex:string)=>{const rgb=hex.slice(1).match(/../g)!.map(c=>parseInt(c,16)/255).map(c=>c<=.04045?c/12.92:((c+.055)/1.055)**2.4);return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;};const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);}
export const onSecondary=(theme:typeof themes[number])=>contrast(theme.secondary,theme.ink)>=4.5?theme.ink:contrast(theme.secondary,'#ffffff')>=4.5?'#ffffff':'#241c2f';
