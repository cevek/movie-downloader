import { Transmission, SettingsConfig } from 'node-transmission-typescript';
import { ITorrent } from "node-transmission-typescript/dist/models";
import * as childProcess from 'child_process';
import * as fs from 'fs';
var mkdirp = require('mkdirp');


var downloadsDir = '/Users/cevek/Download/torrent-movies/';
// var torrent = 'magnet:?xt=urn:btih:71715CEF2F54D8CA277B892B3870605DF3E2748E&tr=http%3A%2F%2Fbt2.t-ru.org%2Fann%3Fmagnet&dn=%D0%9F%D0%BE%D1%81%D0%BB%D0%B5%D0%B4%D0%BD%D0%B8%D0%B9%20%D1%81%D0%B0%D0%BC%D1%83%D1%80%D0%B0%D0%B9%20%2F%20The%20Last%20Samurai%20(%D0%AD%D0%B4%D0%B2%D0%B0%D1%80%D0%B4%20%D0%A6%D0%B2%D0%B8%D0%BA%20%2F%20Edward%20Zwick)%20%5B2003%2C%20%D0%B1%D0%BE%D0%B5%D0%B2%D0%B8%D0%BA%2C%20%D0%B4%D1%80%D0%B0%D0%BC%D0%B0%2C%20%D0%BF%D1%80%D0%B8%D0%BA%D0%BB%D1%8E%D1%87%D0%B5%D0%BD%D0%B8%D1%8F%2C%20%D0%B2%D0%BE%D0%B5%D0%BD%D0%BD%D1%8B%D0%B9%2C%20%D0%B8%D1%81%D1%82%D0%BE%D1%80%D0%B8%D1%8F%2C%20BDRip-AVC%5D%20Dub%20%2B%20Original%20eng%20%2B';

var createdFilesPrefix = '__';

type Maybe<T> = T | undefined;

// main().catch(err => console.error(err));


enum MediaFileStatus {
    EXTRACTING_INFO = 'EXTRACTING_INFO',
    EXTRACTING_STREAMS = 'EXTRACTING_STREAMS',
    CONVERTING_AUDIO = 'CONVERTING_AUDIO',
    REBUILDING_VIDEO = 'REBUILDING_VIDEO',
    UPLOADING_TO_GDRIVE = 'UPLOADING_TO_GDRIVE',
    REMOVING = 'REMOVING_FILES',
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
    mediaInfo: MediaInfo;
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
    transmission = new Transmission({});
    // queue: ITorrent[] = [];

    constructor(public options: { torrentDownloadLimit: number }) {
        this.runner();
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

    async waitForDone(torrent: ITorrent) {
        return new Promise((resolve, reject) => {
            var timeout;
            wait();
            function wait() {
                if (torrent.percentDone === 1) {
                    resolve();
                }
                else {
                    timeout = setTimeout(wait, 1000);
                }
            }
        });
    }


    async getAllTorrents() {
        return await this.transmission.get();
    }

    async download(torrent: ITorrent) {
        return await this.waitForDone(torrent);
    }

    private async runner() {
        var allTorrents = await this.getAllTorrents();
        var activeTorrentsCount = allTorrents.filter(t => t.status > 0).length;
        var nonActiveTorrents = allTorrents.filter(t => t.status === 0);
        if (activeTorrentsCount >= this.options.torrentDownloadLimit) {
            return;
        }
        var torrent = nonActiveTorrents.shift();
        if (torrent) {
            await this.start(torrent);
            this.waitForDone(torrent).then(() => this.runner())
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
            await this.extractInfoInAllFiles();
            await this.extractVideoStreams();
            await this.findSubs();
            await this.convertEnRuAudio();
            await this.rebuildVideo();
            await this.uploadAllToGDrive();
            await this.removeAllFiles();
        } catch (err) {
            this.log(err instanceof Error ? err.message : err);
            console.log(JSON.stringify(this.movieData, null, 2));
            throw err;
        }
    }

    async readFolderFiles() {
        this.log('readFolderFiles');
        var files = fs.readdirSync(this.movieData.dir).filter(file => file !== '.' && file !== '..' && file !== '.DS_Store' && file.substr(0, createdFilesPrefix.length) !== createdFilesPrefix);
        this.movieData.allFiles = files.map(fileName => new MediaFile(fileName));
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
        var { stdout, stderr } = await this.exec(`ffprobe -v quiet -print_format json -show_format -show_streams "${fileName}"`);
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
            if (file.mediaInfo === void 0) {
                file.mediaInfo = await this.extractMediaInfo(dir + file.fileName);
            }
        }
    }

    async extractVideoStreams() {
        this.log('extractVideoStreams');
        var { allFiles, dir } = this.movieData;
        var video = allFiles.find(file => this.isStreamCodecType(file, 'video'));
        if (video) {
            video.mediaInfo = await this.extractMediaInfo(dir + video.fileName);
            var parts = [];
            var subMediaFiles: MediaFile[] = [];
            for (var i = 0; i < video.mediaInfo.streams.length; i++) {
                var stream = video.mediaInfo.streams[i];
                // var ext = stream.codec_type === 'subtitle' ? 'srt' : (stream.codec_name === 'mjpeg' ? 'jpg' : 'mkv');
                var file = new MediaFile(createdFilesPrefix + stream.index + '.mkv');
                subMediaFiles.push(file);
                //${ext === 'srt' ? '' : '-c copy'} 
                parts.push(`-map 0:${stream.index} -c copy "${dir + file.fileName}"`);
            }
            if (parts.length === 0) {
                this.log('Empty streams');
            } else {
                await this.exec(`ffmpeg -loglevel error -y -i "${dir + video.fileName}" ${parts.join(' ')}`);
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
            const subEn = new MediaFile('__en.srt');
            await exec(`ffmpeg -loglevel error -y -i "${dir + subEnMkv.fileName}" "${dir + subEn.fileName}"`)
            this.movieData.allFiles.push(subEn);
            movieData.subEn = subEn;
        } else {
            this.log('subEn not found');
        }
        if (subRuMkv) {
            const subRu = new MediaFile('__ru.srt');
            await exec(`ffmpeg -loglevel error -y -i "${dir + subRuMkv.fileName}" "${dir + subRu.fileName}"`)
            this.movieData.allFiles.push(subRu);
            movieData.subRu = subRu;
        } else {
            this.log('subRu not found');
        }
    }

    isStreamCodecType(file: MediaFile, type: 'video' | 'audio' | 'subtitle') {
        return file.mediaInfo.streams.length > 0 && file.mediaInfo.streams[0].codec_type === type;
    }

    isMediaFileWithLang(file: MediaFile, langPredicate: (str: Maybe<string>) => boolean) {
        if (file.mediaInfo.streams.length > 0) {
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
        var audioEn = allFiles.find(file => this.isStreamCodecType(file, 'audio') && this.isMediaFileWithLang(file, Worker.isDefinetlyEnglish));
        var audioRu = allFiles.find(file => this.isStreamCodecType(file, 'audio') && this.isMediaFileWithLang(file, Worker.isDefinetlyRussian));
        if (!audioRu) {
            this.log('audioRu not found');
        }
        if (!audioEn) {
            this.log('audioEn not found');
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
        var newAudioFile = new MediaFile(fileName);
        // await this.exec(`ffmpeg -y -loglevel error -i "${dir + audioFile.fileName}" -map 0:0 -c:a libfdk_aac -profile:a aac_he -b:a 40k "${dir + newAudioFile.fileName}"`);
        await this.exec(`ffmpeg -y -loglevel error -i "${dir + audioFile.fileName}" -vn -sn -map 0:0 -c copy "${dir + newAudioFile.fileName}"`);
        newAudioFile.mediaInfo = await this.extractMediaInfo(dir + newAudioFile.fileName);
        return newAudioFile;
    }


    async rebuildVideo() {
        this.log('rebuildVideo');
        var { movieData, movieData: { allFiles, audioEnConverted, dir } } = this;
        var videoIdx = allFiles.findIndex(file => this.isStreamCodecType(file, 'video'));
        var video = allFiles[videoIdx];
        if (video && audioEnConverted) {
            var videoEn = new MediaFile(createdFilesPrefix + 'videoEn.mkv');
            await this.exec(`ffmpeg -y -loglevel error -i "${dir + video.fileName}" -i "${dir + audioEnConverted.fileName}" -map 0:0 -map 1:0 -c copy "${dir + videoEn.fileName}"`);
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
        var jsonFile = new MediaFile(createdFilesPrefix + 'data.json');
        fs.writeFileSync(dir + jsonFile.fileName, JSON.stringify(this.movieData, null, 2));
        allFiles.push(jsonFile);

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

var worker = new Worker(1, 'magnet:?xt=urn:btih:5EF07958AE01177F997E5772AE4B1FA243C1A987', torrentWorker);
worker.doWork().catch(err => console.error(err));

var worker = new Worker(222, 'magnet:?xt=urn:btih:71715CEF2F54D8CA277B892B3870605DF3E2748E&tr=http%3A%2F%2Fbt2.t-ru.org%2Fann%3Fmagnet&dn=%D0%9F%D0%BE%D1%81%D0%BB%D0%B5%D0%B4%D0%BD%D0%B8%D0%B9%20%D1%81%D0%B0%D0%BC%D1%83%D1%80%D0%B0%D0%B9%20%2F%20The%20Last%20Samurai%20(%D0%AD%D0%B4%D0%B2%D0%B0%D1%80%D0%B4%20%D0%A6%D0%B2%D0%B8%D0%BA%20%2F%20Edward%20Zwick)%20%5B2003%2C%20%D0%B1%D0%BE%D0%B5%D0%B2%D0%B8%D0%BA%2C%20%D0%B4%D1%80%D0%B0%D0%BC%D0%B0%2C%20%D0%BF%D1%80%D0%B8%D0%BA%D0%BB%D1%8E%D1%87%D0%B5%D0%BD%D0%B8%D1%8F%2C%20%D0%B2%D0%BE%D0%B5%D0%BD%D0%BD%D1%8B%D0%B9%2C%20%D0%B8%D1%81%D1%82%D0%BE%D1%80%D0%B8%D1%8F%2C%20BDRip-AVC%5D%20Dub%20%2B%20Original%20eng%20%2B', torrentWorker);
worker.doWork().catch(err => console.error(err));

