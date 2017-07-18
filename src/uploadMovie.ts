import { Youtube } from './drive';
import { configDir } from './config';
import * as fs from 'fs';

var drive = new Youtube(configDir);
async function main() {
    await drive.auth();
    var res = await drive.upload('FOo', fs.readFileSync('/Users/cody/Downloads/Фильмы/MaR7iAn1n.2015.D.HDRip/1.mp4'));
    console.log(res);
    console.log('Done');
}

main().catch(err => console.error(err.stack));
