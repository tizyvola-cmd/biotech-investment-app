var fs=require('fs');
var src='c:/coding/Biotech_Investment app 6/desktop-ui/src/components/CapDivStep2RiskView.tsx';
var out='c:/coding/Biotech_Investment app 6/desktop-ui/__inspect_out.txt';
var content=fs.readFileSync(src,'utf8');
var lines=content.split('\n');
fs.writeFileSync(out, 'LINE130:'+JSON.stringify(lines[130])+'\nLINE131:'+JSON.stringify(lines[131])+'\n');
lines.splice(130, 1);
fs.writeFileSync(src, lines.join('\n'));
fs.appendFileSync(out, 'DONE\n');

