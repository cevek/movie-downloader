import { Transmission, SettingsConfig } from 'node-transmission-typescript';
import { ITorrent } from "node-transmission-typescript/dist/models";
import * as childProcess from 'child_process';
import * as fs from 'fs';
var mkdirp = require('mkdirp');
var x = new Transmission({

});


var dir = '/Users/cevek/Download/torrent-movies/';
var torrent = 'magnet:?xt=urn:btih:71715CEF2F54D8CA277B892B3870605DF3E2748E&tr=http%3A%2F%2Fbt2.t-ru.org%2Fann%3Fmagnet&dn=%D0%9F%D0%BE%D1%81%D0%BB%D0%B5%D0%B4%D0%BD%D0%B8%D0%B9%20%D1%81%D0%B0%D0%BC%D1%83%D1%80%D0%B0%D0%B9%20%2F%20The%20Last%20Samurai%20(%D0%AD%D0%B4%D0%B2%D0%B0%D1%80%D0%B4%20%D0%A6%D0%B2%D0%B8%D0%BA%20%2F%20Edward%20Zwick)%20%5B2003%2C%20%D0%B1%D0%BE%D0%B5%D0%B2%D0%B8%D0%BA%2C%20%D0%B4%D1%80%D0%B0%D0%BC%D0%B0%2C%20%D0%BF%D1%80%D0%B8%D0%BA%D0%BB%D1%8E%D1%87%D0%B5%D0%BD%D0%B8%D1%8F%2C%20%D0%B2%D0%BE%D0%B5%D0%BD%D0%BD%D1%8B%D0%B9%2C%20%D0%B8%D1%81%D1%82%D0%BE%D1%80%D0%B8%D1%8F%2C%20BDRip-AVC%5D%20Dub%20%2B%20Original%20eng%20%2B';

var createdFilesPrefix = '__';

async function main() {
    await x.start([1]);
    // await x.remove([1], true);
    // var t = await x.addUrl(torrent, {'download-dir': dir} as any);
    // console.log(t);
    var torrents = await x.get();
    console.log(torrents);
}

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
        language?: string;
        title?: string;
        filename?: string;
        mimetype?: string;
    }
}

class MediaFile {
    gdriveId = '';
    get localFileName() {
        return dir + this.fileName;
    }
    fileName = '';
    mediaInfo: MediaInfo;
}

interface MovieData {
    id: number;
    torrent: ITorrent;
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

class Worker {
    movieData: MovieData;
    constructor(id: number, torrent: ITorrent) {
        this.movieData = {
            id,
            torrent,
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
        this.movieData.logs.push(stderr + stderr);
        return { stdout, stderr };
    }

    async doWork() {
        try {
            mkdirp.sync(dir);
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
            this.movieData.logs.push(err instanceof Error ? err.message : err);
            console.log(JSON.stringify(this.movieData, null, 2));
            throw err;
        }
    }

    async readFolderFiles() {
        this.log('readFolderFiles');
        var files = fs.readdirSync(dir).filter(file => file !== '.' && file !== '..' && file !== '.DS_Store' && file.substr(0, createdFilesPrefix.length) !== createdFilesPrefix);
        this.movieData.allFiles = files.map(fileName => {
            var file = new MediaFile();
            file.fileName = fileName;
            return file;
        });
    }

    async downloadTorrent() {
        this.log('downloadTorrent');
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
        var { allFiles } = this.movieData;
        for (var i = 0; i < allFiles.length; i++) {
            var file = allFiles[i];
            if (file.mediaInfo === void 0) {
                file.mediaInfo = await this.extractMediaInfo(file.localFileName);
            }
        }
    }

    async extractVideoStreams() {
        this.log('extractVideoStreams');
        var { allFiles, logs } = this.movieData;
        var video = allFiles.find(file => this.isStreamCodecType(file, 'video'));
        if (video) {
            video.mediaInfo = await this.extractMediaInfo(video.localFileName);
            var parts = [];
            var subMediaFiles: MediaFile[] = [];
            for (var i = 0; i < video.mediaInfo.streams.length; i++) {
                var stream = video.mediaInfo.streams[i];
                var ext = stream.codec_type === 'subtitle' ? 'srt' : 'mkv';
                var file = new MediaFile();
                file.fileName = createdFilesPrefix + stream.index + '.' + ext;
                subMediaFiles.push(file);
                parts.push(`-map 0:${stream.index} ${ext === 'srt' ? '' : '-c copy'} "${file.localFileName}"`);
            }
            await this.exec(`ffmpeg -loglevel error -y -i "${video.localFileName}" ${parts.join(' ')}`);
            allFiles.push(...subMediaFiles);
            await this.extractInfoInAllFiles();
        }
    }

    async findSubs() {
        this.log('findSubs');
        var { movieData, movieData: { allFiles } } = this;
        movieData.subRu = allFiles.find(file => this.isStreamCodecType(file, 'subtitle') && this.isRussianMediaFile(file));
        movieData.subEn = allFiles.find(file => this.isStreamCodecType(file, 'subtitle') && this.isRussianMediaFile(file) === false);
    }

    isStreamCodecType(file: MediaFile, type: 'video' | 'audio' | 'subtitle') {
        return file.mediaInfo.streams.length > 0 && file.mediaInfo.streams[0].codec_type === type;
    }

    isRussianMediaFile(file: MediaFile) {
        if (file.mediaInfo.streams.length > 0) {
            var stream = file.mediaInfo.streams[0];
            if (stream.tags && (this.isRussianTitle(stream.tags.language) || this.isRussianTitle(stream.tags.title))) {
                return true;
            }
        }
        if (this.isRussianTitle(file.fileName)) {
            return true;
        }
        return false;
    }

    isRussianTitle(str: Maybe<string>) {
        return str ? /(\brus?\b|\bдубляж\b|\bперевод\b)/i.test(str) : false;
    }


    async convertEnRuAudio() {
        this.log('convertEnRuAudio');
        var { movieData, movieData: { allFiles } } = this;
        var audioEn = allFiles.find(file => this.isStreamCodecType(file, 'audio') && this.isRussianMediaFile(file) === false);
        var audioRu = allFiles.find(file => this.isStreamCodecType(file, 'audio') && this.isRussianMediaFile(file));
        if (audioEn) {
            movieData.audioEnConverted = await this.convertAudio(audioEn, createdFilesPrefix + 'en.m4a');
            allFiles.push(movieData.audioEnConverted);
        }
        if (audioRu) {
            movieData.audioRuConverted = await this.convertAudio(audioRu, createdFilesPrefix + 'ru.m4a');
            allFiles.push(movieData.audioRuConverted);
        }
    }

    async convertAudio(audioFile: MediaFile, fileName: string) {
        this.log('convertAudio');
        var newAudioFile = new MediaFile();
        newAudioFile.fileName = fileName;
        await this.exec(`ffmpeg -y -loglevel error -i "${audioFile.localFileName}" -c:a libfdk_aac -profile:a aac_he_v2 -b:a 32k "${newAudioFile.localFileName}"`);
        newAudioFile.mediaInfo = await this.extractMediaInfo(newAudioFile.localFileName);
        return newAudioFile;
    }


    async rebuildVideo() {
        this.log('rebuildVideo');
        var { movieData, movieData: { logs, allFiles, audioEnConverted } } = this;
        var videoIdx = allFiles.findIndex(file => this.isStreamCodecType(file, 'video') && this.isRussianMediaFile(file) === false);
        var video = allFiles[videoIdx];
        if (video && audioEnConverted) {
            var videoEn = new MediaFile();
            videoEn.fileName = createdFilesPrefix + 'videoEn.mkv';
            await this.exec(`ffmpeg -y -loglevel error -i "${video.localFileName}" -i ${audioEnConverted.localFileName} -c copy ${videoEn.fileName}`);
            movieData.videoEn = videoEn;
            allFiles.splice(videoIdx, 1);
            allFiles.push(videoEn);
        }
    }

    async uploadAllToGDrive() {
        this.log('uploadAllToGDrive');
        var { movieData: { allFiles } } = this;
        var promises = [];
        for (var i = 0; i < allFiles.length; i++) {
            var file = allFiles[i];
            promises.push(this.uploadFileToGDrive(file));
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

    log(type: string, fileName?: string) {
        console.log(type + (fileName ? ': ' + fileName : ''));
    }
}

var worker = new Worker(1, {} as any);
worker.doWork().catch(err => console.error(err));

