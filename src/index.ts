import { Transmission, SettingsConfig } from 'node-transmission-typescript';
import { ITorrent } from 'node-transmission-typescript/dist/models';
import * as childProcess from 'child_process';
import * as fs from 'fs';
import { query } from './db';
var mkdirp = require('mkdirp');
var shellEscape = require('shell-escape');


function shellArgEscape(str: string): string {
    return shellEscape([str]);
}



var downloadsDir = '/Users/cody/Download/torrent-movies/';
// var torrent = 'magnet:?xt=urn:btih:71715CEF2F54D8CA277B892B3870605DF3E2748E&tr=http%3A%2F%2Fbt2.t-ru.org%2Fann%3Fmagnet&dn=%D0%9F%D0%BE%D1%81%D0%BB%D0%B5%D0%B4%D0%BD%D0%B8%D0%B9%20%D1%81%D0%B0%D0%BC%D1%83%D1%80%D0%B0%D0%B9%20%2F%20The%20Last%20Samurai%20(%D0%AD%D0%B4%D0%B2%D0%B0%D1%80%D0%B4%20%D0%A6%D0%B2%D0%B8%D0%BA%20%2F%20Edward%20Zwick)%20%5B2003%2C%20%D0%B1%D0%BE%D0%B5%D0%B2%D0%B8%D0%BA%2C%20%D0%B4%D1%80%D0%B0%D0%BC%D0%B0%2C%20%D0%BF%D1%80%D0%B8%D0%BA%D0%BB%D1%8E%D1%87%D0%B5%D0%BD%D0%B8%D1%8F%2C%20%D0%B2%D0%BE%D0%B5%D0%BD%D0%BD%D1%8B%D0%B9%2C%20%D0%B8%D1%81%D1%82%D0%BE%D1%80%D0%B8%D1%8F%2C%20BDRip-AVC%5D%20Dub%20%2B%20Original%20eng%20%2B';

var createdFilesPrefix = '__';
var createdFilesPrefixRegexp = /\/__/;

type Maybe<T> = T | undefined;

// main().catch(err => console.error(err));

function walkDir(dir: string) {
    var results: string[] = []
    var list = fs.readdirSync(dir);
    if (dir[dir.length - 1] === '/') {
        dir = dir.substr(0, dir.length - 1);
    }
    list.forEach(function (file) {
        file = dir + '/' + file;
        var stat = fs.statSync(file)
        if (stat && stat.isDirectory()) {
            results = results.concat(walkDir(file))
        }
        else {
            results.push(file);
        }
    })
    return results;
}


function num(value: string): number {
    var val = +value;
    if (val !== val) {
        throw new Error(`${value} is not a number`);
    }
    return val;
}

interface MediaInfo {
    streams: Stream[];
    format: {
        duration: string;
        bit_rate: string;
        format_name: string;
        tags: {
            title: string;
        }
    };
    chapters?: {
        start_time: string;
        end_time: string;
        tags?: {
            title?: string;
        }
    }[];
}

interface Stream {
    index: number;
    codec_name: string;
    codec_type: 'video' | 'audio' | 'subtitle';
    start_time: string;
    // video
    width?: number;
    height?: number;

    //audio
    sample_rate?: string;
    channels?: number;

    //subs
    duration?: string;

    tags?: {
        LANGUAGE?: string;
        language?: string;
        title?: string;
        filename?: string;
        mimetype?: string;
        MIMETYPE?: string;
    }
}

class MediaFile {
    gdriveId = '';
    skipToUpload = false;
    mediaInfo: Maybe<MediaInfo>;
    videoStreamIdx = -1;
    constructor(public fileName: string) {

    }
}

interface MovieData {
    id: number;
    dir: string;
    magnetUrl: string;
    torrent: Maybe<ITorrent>;
    videoEn: Maybe<MediaFile>;
    audioRuConverted: Maybe<MediaFile>;
    audioEnConverted: Maybe<MediaFile>;
    subRu: Maybe<MediaFile>;
    subEn: Maybe<MediaFile>;
    allFiles: MediaFile[];

    logs: string[];
}

async function exec(command: string, options?: childProcess.ExecOptions) {
    return new Promise<{ stdout: string, stderr: string }>((resolve, reject) => {
        childProcess.exec(command, options!, (err, stdout, stderr) => {
            if (err) return reject(err);
            resolve({ stdout, stderr });
        });
    });
}

class TorrentWorker {
    allTorrents: ITorrent[] = [];
    transmission = new Transmission({});
    // queue: ITorrent[] = [];

    constructor(public options: { torrentDownloadLimit: number }) {
        this.updateAllTorrents();
    }

    async updateAllTorrents() {
        var update = () => {
            this.getAllTorrents().then(allTorrents => {
                this.allTorrents = allTorrents;
                var activeTorrentsCount = allTorrents.filter(torrent => torrent.status > 0).length;
                if (activeTorrentsCount > 0) {
                    setTimeout(update, 1000);
                }
            })
        }
        update();
    }

    async addOrFindMagnetUrl(magnetUrl: string, dir: string) {
        var allTorrents = await this.transmission.get();
        var existTorrent = allTorrents.find(t => t.magnetLink === magnetUrl);
        if (existTorrent) {
            return existTorrent;
        }
        var { id } = await this.transmission.addUrl(magnetUrl, { 'download-dir': dir } as any);

        return (await this.transmission.get([id])).pop()!;
    }

    async waitForDone(torrentId: number) {
        return new Promise((resolve, reject) => {
            var timeout;
            var wait = () => {
                var torrent = this.allTorrents.find(t => t.id === torrentId);
                if (torrent && torrent.percentDone === 1) {
                    resolve();
                }
                else {
                    timeout = setTimeout(wait, 1000);
                }
            }
            wait();
        });
    }


    async getAllTorrents() {
        return await this.transmission.get();
    }

    async download(torrent: ITorrent) {
        return await this.waitForDone(torrent.id);
    }

    private async runner() {
        var activeTorrentsCount = this.allTorrents.filter(t => t.status > 0).length;
        var nonActiveTorrents = this.allTorrents.filter(t => t.status === 0);
        if (activeTorrentsCount >= this.options.torrentDownloadLimit) {
            return;
        }
        var torrent = nonActiveTorrents.shift();
        if (torrent) {
            await this.start(torrent);
            this.waitForDone(torrent.id).then(() => this.runner())
            await this.runner();
        }
    }

    async start(torrent: ITorrent) {
        return this.transmission.start([torrent.id]);
    }

    async remove(torrent: ITorrent) {
        return this.transmission.remove([torrent.id], true);
    }

    async stop(torrent: ITorrent) {
        return this.transmission.stop([torrent.id]);
    }

    async freeSpace(folder: string) {
        return this.transmission.freeSpace(folder);
    }

}


class Worker {
    movieData: MovieData;
    torrentWorker: TorrentWorker;

    constructor(id: number, magnetUrl: string, torrentWorker: TorrentWorker) {
        this.torrentWorker = torrentWorker;
        this.movieData = {
            id,
            magnetUrl,
            dir: downloadsDir + id + '/',
            torrent: void 0,
            videoEn: void 0,
            audioRuConverted: void 0,
            audioEnConverted: void 0,
            subRu: void 0,
            subEn: void 0,
            allFiles: [],
            logs: []
        }
    }

    async exec(command: string, options: childProcess.ExecOptions = {}) {
        if (options.maxBuffer === void 0) {
            options.maxBuffer = 10 * 1000 * 1000;
        }
        this.log('exec', command);
        var { stdout, stderr } = await exec(command, options);
        if (stderr) {
            this.log(stderr);
        }
        return { stdout, stderr };
    }

    async doWork() {
        try {
            mkdirp.sync(this.movieData.dir);
            await this.downloadTorrent();
            await this.readFolderFiles();
            await this.removeCreatedFiles();
            await this.extractInfoInAllFiles();
            await this.extractVideoStreams();
            await this.findSubs();
            await this.convertEnRuAudio();
            await this.rebuildVideo();
            await this.saveDataJSON();
            await this.uploadAllToGDrive();
            await this.removeAllFiles();
        } catch (err) {
            this.log(err instanceof Error ? err.stack : err);
            await this.saveDataJSON();
            // console.log(JSON.stringify(this.movieData, null, 2));
            throw err;
        }
    }

    async saveDataJSON() {
        var { allFiles, dir } = this.movieData;
        var jsonFile = new MediaFile(dir + createdFilesPrefix + 'data.json');
        fs.writeFileSync(jsonFile.fileName, JSON.stringify(this.movieData, null, 2));
        allFiles.push(jsonFile);
    }

    async readFolderFiles() {
        this.log('readFolderFiles');
        var files = walkDir(this.movieData.dir).filter(file => /(DS_Store)$/.test(file) === false && createdFilesPrefixRegexp.test(file) === false);
        this.movieData.allFiles = files.map(fileName => new MediaFile(fileName));
    }

    async removeCreatedFiles() {
        this.log('removeCreatedFiles');
        var createdFiles = walkDir(this.movieData.dir).filter(file => createdFilesPrefixRegexp.test(file));
        for (var i = 0; i < createdFiles.length; i++) {
            var fileName = createdFiles[i];
            fs.unlinkSync(fileName);
        }
    }

    async downloadTorrent() {
        this.log('downloadTorrent');
        var { movieData } = this;
        var torrent = await this.torrentWorker.addOrFindMagnetUrl(this.movieData.magnetUrl, this.movieData.dir);
        this.movieData.torrent = torrent;
        await this.torrentWorker.download(torrent);
    }

    async extractMediaInfo(fileName: string) {
        this.log('extractMediaInfo', fileName);
        var { stdout, stderr } = await this.exec(`ffprobe -v quiet -print_format json -show_format -show_streams -show_chapters ${shellArgEscape(fileName)}`);
        if (stderr) throw new Error(stderr);
        try {
            return JSON.parse(stdout) as MediaInfo;
        } catch (e) {
            throw new Error(`Incorrect json: ${stdout}`);
        }
    }

    async extractInfoInAllFiles() {
        this.log('extractInfoInAllFiles');
        var { allFiles, dir } = this.movieData;
        for (var i = 0; i < allFiles.length; i++) {
            var file = allFiles[i];
            if (file.mediaInfo === void 0 && /(mp3|aac|ac3|dts|mkv|avi|flv|mpe?g|ogg|m4a|mp4|m4v|mov|qt|jpe?g|png|gif|flac|srt|sub|ass|ssa)$/i.test(file.fileName)) {
                file.mediaInfo = await this.extractMediaInfo(file.fileName);
            }
        }
    }

    async extractVideoStreams() {
        this.log('extractVideoStreams');
        var { allFiles, dir } = this.movieData;
        var video = allFiles.find(file => this.isStreamCodecType(file, 'video'));
        if (video) {
            video.mediaInfo = await this.extractMediaInfo(video.fileName);
            var containerFormat = video.mediaInfo.format.format_name;
            var parts = [];
            var subMediaFiles: MediaFile[] = [];
            for (var i = 0; i < video.mediaInfo.streams.length; i++) {
                var stream = video.mediaInfo.streams[i];
                var ext = containerFormat === 'avi' ? 'avi' : 'mkv';
                var file = new MediaFile(dir + createdFilesPrefix + stream.index + '.' + ext);
                file.videoStreamIdx = stream.index;
                subMediaFiles.push(file);
                //${ext === 'srt' ? '' : '-c copy'} 
                parts.push(`-map 0:${stream.index} -c copy ${shellArgEscape(file.fileName)}`);
            }
            if (parts.length === 0) {
                this.log('Empty streams');
            } else {
                await this.exec(`ffmpeg -loglevel error -y -i ${shellArgEscape(video.fileName)} ${parts.join(' ')}`);
            }
            allFiles.push(...subMediaFiles);
            await this.extractInfoInAllFiles();
        }
    }

    async findSubs() {
        this.log('findSubs');
        var { movieData, movieData: { allFiles, dir } } = this;
        var subEnMkv = allFiles.find(file => this.isStreamCodecType(file, 'subtitle') && this.isMediaFileWithLang(file, Worker.isDefinetlyEnglish));
        var subRuMkv = allFiles.find(file => this.isStreamCodecType(file, 'subtitle') && this.isMediaFileWithLang(file, Worker.isDefinetlyRussian));
        if (!subEnMkv) {
            subEnMkv = allFiles.find(file => this.isStreamCodecType(file, 'subtitle') && this.isMediaFileWithLang(file, Worker.isDefinetlyRussian) === false);
        }
        if (subEnMkv) {
            const subEn = new MediaFile(dir + '__en.srt');
            await exec(`ffmpeg -loglevel error -y -i '${subEnMkv.fileName}' '${subEn.fileName}'`)
            this.movieData.allFiles.push(subEn);
            movieData.subEn = subEn;
        } else {
            this.log('subEn not found');
        }
        if (subRuMkv) {
            const subRu = new MediaFile(dir + '__ru.srt');
            await exec(`ffmpeg -loglevel error -y -i '${subRuMkv.fileName}' '${subRu.fileName}'`)
            this.movieData.allFiles.push(subRu);
            movieData.subRu = subRu;
        } else {
            this.log('subRu not found');
        }
    }

    isStreamCodecType(file: MediaFile, type: 'video' | 'audio' | 'subtitle') {
        return (file.mediaInfo && file.mediaInfo.streams.length > 0 && file.mediaInfo.streams[0].codec_type === type) ? true : false;
    }

    isMediaFileWithLang(file: MediaFile, langPredicate: (str: Maybe<string>) => boolean) {
        if (file.mediaInfo && file.mediaInfo.streams.length > 0) {
            var stream = file.mediaInfo.streams[0];
            if (stream.tags && (langPredicate(stream.tags.language) || langPredicate(stream.tags.LANGUAGE) || langPredicate(stream.tags.title))) {
                return true;
            }
        }
        if (langPredicate(file.fileName)) {
            return true;
        }
        return false;
    }

    static isDefinetlyRussian(str: Maybe<string>) {
        return str ? /(\brus?\b|дубляж|перевод|русск)/i.test(str) : false;
    }

    static isDefinetlyEnglish(str: Maybe<string>) {
        return str ? /(\beng\b|англ)/i.test(str) : false;
    }
    async convertEnRuAudio() {
        this.log('convertEnRuAudio');
        var { movieData, movieData: { allFiles } } = this;
        var audioFiles = allFiles.filter(file => this.isStreamCodecType(file, 'audio'));
        var audioEn = audioFiles.find(file => this.isMediaFileWithLang(file, Worker.isDefinetlyEnglish));
        var audioRu = audioFiles.find(file => this.isMediaFileWithLang(file, Worker.isDefinetlyRussian));
        if (!audioEn) {
            audioEn = audioFiles.find(file => file.videoStreamIdx !== 1 && this.isMediaFileWithLang(file, Worker.isDefinetlyRussian) === false);
            this.log('audioEn not found');
        }
        if (!audioRu) {
            audioRu = audioFiles.find(file => file.videoStreamIdx === 1);
            this.log('audioRu not found');
        }
        var promises = [
            audioEn ? this.convertAudio(audioEn, createdFilesPrefix + 'en.m4a') : Promise.resolve(void 0),
            audioRu ? this.convertAudio(audioRu, createdFilesPrefix + 'ru.m4a') : Promise.resolve(void 0),
        ];
        var [enConverted, ruConverted] = await Promise.all(promises);
        if (enConverted) {
            movieData.audioEnConverted = enConverted;
            allFiles.push(enConverted);
        }
        if (ruConverted) {
            movieData.audioRuConverted = ruConverted;
            allFiles.push(ruConverted);
        }
    }

    async convertAudio(audioFile: MediaFile, fileName: string) {
        var { dir } = this.movieData;
        this.log('convertAudio', fileName);
        var newAudioFile = new MediaFile(dir + fileName);
        // await this.exec(`ffmpeg -y -loglevel error -i '${audioFile.fileName}' -map 0:0 -c:a libfdk_aac -profile:a aac_he -b:a 40k '${newAudioFile.fileName}'`);
        await this.exec(`ffmpeg -y -loglevel error -i ${shellArgEscape(audioFile.fileName)} -vn -sn -map 0:0 -c copy ${shellArgEscape(newAudioFile.fileName)}`);
        newAudioFile.mediaInfo = await this.extractMediaInfo(newAudioFile.fileName);
        return newAudioFile;
    }


    async rebuildVideo() {
        this.log('rebuildVideo');
        var { movieData, movieData: { allFiles, audioEnConverted, dir } } = this;
        var videoIdx = allFiles.findIndex(file => this.isStreamCodecType(file, 'video'));
        var video = allFiles[videoIdx];
        if (video && audioEnConverted) {
            var ext = video.mediaInfo!.format.format_name === 'avi' ? 'avi' : 'mkv';
            var videoEn = new MediaFile(dir + createdFilesPrefix + 'videoEn.' + ext);
            await this.exec(`ffmpeg -y -loglevel error -i ${shellArgEscape(video.fileName)} -i ${shellArgEscape(audioEnConverted.fileName)} -map 0:0 -map 1:0 -c copy ${shellArgEscape(videoEn.fileName)}`);
            movieData.videoEn = videoEn;
            allFiles.push(videoEn);
            await this.extractInfoInAllFiles();
            video.skipToUpload = true;
        } else {
            if (!video) {
                this.log('video not found');
            }
            if (!audioEnConverted) {
                this.log('audioEnConverted not found');
            }
        }
    }

    async uploadAllToGDrive() {
        this.log('uploadAllToGDrive');
        var { movieData: { allFiles } } = this;
        var promises = [];
        for (var i = 0; i < allFiles.length; i++) {
            var file = allFiles[i];
            if (file.skipToUpload === false) {
                promises.push(this.uploadFileToGDrive(file));
            }
        }
        await Promise.all(promises);
    }

    async uploadFileToGDrive(file: MediaFile) {
        this.log('uploadFileToGDrive', file.fileName);
    }

    async removeAllFiles() {
        this.log('removeAllFiles');
        var { movieData: { allFiles } } = this;
        for (var i = 0; i < allFiles.length; i++) {
            var file = allFiles[i];
            this.log('removeFile', file.fileName);
            // fs.unlinkSync(file.localFileName);
        }
    }

    async removeTorrent() {
        this.log('removeTorrent');
        // await this.torrentWorker.remove(this.movieData.torrent!);
    }

    log(type: string, fileName?: string) {
        var s = type + (fileName ? ': ' + fileName : '');
        this.movieData.logs.push(s);
        console.log(s);
    }
}

var torrentWorker = new TorrentWorker({ torrentDownloadLimit: 1 });

// var worker = new Worker(111, 'magnet:?xt=urn:btih:5EF07958AE01177F997E5772AE4B1FA243C1A987', torrentWorker);
// worker.doWork().catch(err => console.error(err));

// var worker = new Worker(222, 'magnet:?xt=urn:btih:71715CEF2F54D8CA277B892B3870605DF3E2748E&tr=http%3A%2F%2Fbt2.t-ru.org%2Fann%3Fmagnet&dn=%D0%9F%D0%BE%D1%81%D0%BB%D0%B5%D0%B4%D0%BD%D0%B8%D0%B9%20%D1%81%D0%B0%D0%BC%D1%83%D1%80%D0%B0%D0%B9%20%2F%20The%20Last%20Samurai%20(%D0%AD%D0%B4%D0%B2%D0%B0%D1%80%D0%B4%20%D0%A6%D0%B2%D0%B8%D0%BA%20%2F%20Edward%20Zwick)%20%5B2003%2C%20%D0%B1%D0%BE%D0%B5%D0%B2%D0%B8%D0%BA%2C%20%D0%B4%D1%80%D0%B0%D0%BC%D0%B0%2C%20%D0%BF%D1%80%D0%B8%D0%BA%D0%BB%D1%8E%D1%87%D0%B5%D0%BD%D0%B8%D1%8F%2C%20%D0%B2%D0%BE%D0%B5%D0%BD%D0%BD%D1%8B%D0%B9%2C%20%D0%B8%D1%81%D1%82%D0%BE%D1%80%D0%B8%D1%8F%2C%20BDRip-AVC%5D%20Dub%20%2B%20Original%20eng%20%2B', torrentWorker);
// worker.doWork().catch(err => console.error(err));

interface MovieDownload {
    id: number;
    title: string;
    hash: string;
}
async function main() {
    var list = await query<MovieDownload[]>('SELECT d.id, rt.title, rt.hash FROM downloads d LEFT JOIN rt ON rt.id = rtId WHERE gdId IS NULL LIMIT 10,10');
    var promises = [];
    for (var i = 0; i < list.length; i++) {
        var row = list[i];
        var worker = new Worker(row.id, 'magnet:?xt=urn:btih:' + row.hash, torrentWorker);
        promises.push(worker.doWork());
    }
    await Promise.all(promises);
}
main().catch(err => err instanceof Error ? console.error('----------------------------------\n' + err.stack) : err);

