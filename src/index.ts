import { Transmission, SettingsConfig } from 'node-transmission-typescript';
import { ITorrent } from 'node-transmission-typescript/dist/models';
import * as childProcess from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { query } from './db';
import { Drive, Youtube } from './drive';
import { configDir } from './config';
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
    var results: string[] = [];
    var list = fs.readdirSync(dir);
    if (dir[dir.length - 1] === '/') {
        dir = dir.substr(0, dir.length - 1);
    }
    list.forEach(function(file) {
        file = dir + '/' + file;
        var stat = fs.statSync(file);
        if (stat && stat.isDirectory()) {
            results = results.concat(walkDir(file));
        } else {
            results.push(file);
        }
    });
    return results;
}

function num(value: string): number {
    var val = +value;
    if (val !== val) {
        throw new Error(`${value} is not a number`);
    }
    return val;
}

enum DownloadStatus {
    ERRORED = -1,
    SKIP = 0,
    NEED_TO_DOWNLOAD = 1,
    DONE = 2,
}

interface Download {
    id: number;
    kpId: number;
    rtId: number;
    gdId: Maybe<string>;
    startedAt: Maybe<Date>;
    endedAt: Maybe<Date>;
    logs: string;
    status: DownloadStatus;
    size: number;
    hash: string;
}

interface MediaInfo {
    streams: Stream[];
    format: {
        duration: string;
        bit_rate: string;
        format_name: string;
        tags: {
            title: string;
        };
    };
    chapters?: {
        start_time: string;
        end_time: string;
        tags?: {
            title?: string;
        };
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
    };
}

class MediaFile {
    gdriveId = '';
    skipToUpload = false;
    mediaInfo: Maybe<MediaInfo>;
    videoStream: Maybe<Stream>;
    constructor(public fileName: string) {}
}

interface MovieData {
    id: number;
    dir: string;
    magnetUrl: string;
    torrent: Maybe<ITorrent>;
    videoEn: Maybe<MediaFile>;
    videoEnParts: MediaFile[];
    audioRuConverted: Maybe<MediaFile>;
    audioEnConverted: Maybe<MediaFile>;
    allSubsData: { enIdx: number; ruIdx: number; all: { info: MediaFile; content: string }[] };
    allFiles: MediaFile[];

    logs: string[];
}

async function exec(command: string, options?: childProcess.ExecOptions) {
    return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
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
            });
        };
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
                } else {
                    timeout = setTimeout(wait, 1000);
                }
            };
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
            this.waitForDone(torrent.id).then(() => this.runner());
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
    drive: Drive;
    youtube: Youtube;

    constructor(id: number, magnetUrl: string, torrentWorker: TorrentWorker, youtube: Youtube /* , drive: Drive */) {
        this.torrentWorker = torrentWorker;
        // this.drive = drive;
        this.youtube = youtube;
        this.movieData = {
            id,
            magnetUrl,
            dir: downloadsDir + id + '/',
            torrent: void 0,
            videoEn: void 0,
            videoEnParts: [],
            audioRuConverted: void 0,
            audioEnConverted: void 0,
            allFiles: [],
            allSubsData: { enIdx: -1, ruIdx: -1, all: [] },
            logs: [],
        };
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
            // await this.convertEnRuAudio();
            // await this.rebuildVideo();
            // await this.uploadAllToGDrive();
            await this.splitVideoTo10MinParts();
            await this.removeAllStreamFiles();
            await this.uploadVideoToYoutube();
            await this.removeAllFiles();
            await this.saveDataJSON();
            await this.save(DownloadStatus.DONE);
            await this.removeCreatedFiles();
        } catch (err) {
            this.log(err instanceof Error ? err.stack : err);
            await this.saveDataJSON();
            await this.save(DownloadStatus.ERRORED);
            // console.log(JSON.stringify(this.movieData, null, 2));
            // throw err;
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
        var files = walkDir(this.movieData.dir).filter(
            file => /(DS_Store)$/.test(file) === false && createdFilesPrefixRegexp.test(file) === false
        );
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
        var { stdout, stderr } = await this.exec(
            `ffprobe -v quiet -print_format json -show_format -show_streams -show_chapters ${shellArgEscape(fileName)}`
        );
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
            if (
                file.mediaInfo === void 0 &&
                /(mp3|aac|ac3|dts|mkv|avi|flv|mpe?g|ogg|m4a|mp4|m4v|mov|qt|jpe?g|png|gif|flac|srt|sub|ass|ssa)$/i.test(
                    file.fileName
                )
            ) {
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
                var ext = stream.codec_type === 'subtitle' ? 'srt' : containerFormat === 'avi' ? 'avi' : 'mkv';
                var file = new MediaFile(dir + createdFilesPrefix + stream.index + '.' + ext);
                file.videoStream = stream;
                subMediaFiles.push(file);
                parts.push(`-map 0:${stream.index} ${ext === 'srt' ? '' : '-c copy'} ${shellArgEscape(file.fileName)}`);
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
        var allSubs = allFiles.filter(file => this.isStreamCodecType(file, 'subtitle'));
        movieData.allSubsData.all.push(
            ...allSubs.map(sub => ({ info: sub, content: fs.readFileSync(sub.fileName, 'utf8') }))
        );
        var subEnIdx = allSubs.findIndex(file => this.isMediaFileWithLang(file, Worker.isDefinetlyEnglish));
        var subRuIdx = allSubs.findIndex(file => this.isMediaFileWithLang(file, Worker.isDefinetlyRussian));

        if (subEnIdx === -1) {
            subEnIdx = allSubs.findIndex(file => this.isMediaFileWithLang(file, Worker.isDefinetlyRussian) === false);
        }

        movieData.allSubsData.enIdx = subEnIdx;
        movieData.allSubsData.ruIdx = subRuIdx;

        if (subEnIdx === -1) {
            this.log('subEn not found');
        }
        if (subRuIdx === -1) {
            this.log('subRu not found');
        }
    }

    isStreamCodecType(file: MediaFile, type: 'video' | 'audio' | 'subtitle') {
        return file.mediaInfo && file.mediaInfo.streams.length > 0 && file.mediaInfo.streams[0].codec_type === type
            ? true
            : false;
    }

    isMediaFileWithLang(file: MediaFile, langPredicate: (str: Maybe<string>) => boolean) {
        if (file.mediaInfo && (file.videoStream || file.mediaInfo.streams.length > 0)) {
            var stream = file.videoStream || file.mediaInfo.streams[0];
            if (
                stream.tags &&
                (langPredicate(stream.tags.language) ||
                    langPredicate(stream.tags.LANGUAGE) ||
                    langPredicate(stream.tags.title))
            ) {
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
        return str ? /(\beng?\b|англ)/i.test(str) : false;
    }
    async convertEnRuAudio() {
        this.log('convertEnRuAudio');
        var { movieData, movieData: { allFiles } } = this;
        var audioFiles = allFiles.filter(file => this.isStreamCodecType(file, 'audio'));
        var audioEn = audioFiles.find(file => this.isMediaFileWithLang(file, Worker.isDefinetlyEnglish));
        var audioRu = audioFiles.find(file => this.isMediaFileWithLang(file, Worker.isDefinetlyRussian));
        if (!audioEn) {
            audioEn = audioFiles.find(
                file =>
                    file.videoStream !== void 0 && this.isMediaFileWithLang(file, Worker.isDefinetlyRussian) === false
            );
            this.log('audioEn not found');
        }
        if (!audioRu) {
            audioRu = audioFiles.find(file => file.videoStream === void 0);
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
        newAudioFile.videoStream = audioFile.videoStream;
        // await this.exec(`ffmpeg -y -loglevel error -i '${audioFile.fileName}' -map 0:0 -c:a libfdk_aac -profile:a aac_he -b:a 40k '${newAudioFile.fileName}'`);
        await this.exec(
            `ffmpeg -y -loglevel error -i ${shellArgEscape(
                audioFile.fileName
            )} -vn -sn -map 0:0 -c copy ${shellArgEscape(newAudioFile.fileName)}`
        );
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
            var offset = (audioEnConverted.videoStream && +audioEnConverted.videoStream.start_time) || 0;
            await this.exec(
                `ffmpeg -y -loglevel error -i ${shellArgEscape(
                    video.fileName
                )} -itsoffset ${offset} -i ${shellArgEscape(
                    audioEnConverted.fileName
                )} -map 0:0 -map 1:0 -c copy ${shellArgEscape(videoEn.fileName)}`
            );
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
        // var folder = await this.drive.createFolder(this.movieData.id + '');
        // var { movieData: { allFiles } } = this;
        // var promises = [];
        // for (var i = 0; i < allFiles.length; i++) {
        //     var file = allFiles[i];
        //     if (file.skipToUpload === false) {
        //         promises.push(this.uploadFileToGDrive(folder.id, file));
        //     }
        // }
        // await Promise.all(promises);
    }

    async splitVideoTo10MinParts() {
        this.log('splitVideoTo10MinParts');
        var { movieData, movieData: { allFiles, dir } } = this;
        var videoIdx = allFiles.findIndex(file => this.isStreamCodecType(file, 'video'));
        var video = allFiles[videoIdx];
        var audioFiles = allFiles.filter(file => this.isStreamCodecType(file, 'audio'));
        var audioEn = audioFiles.find(file => this.isMediaFileWithLang(file, Worker.isDefinetlyEnglish));
        if (video && audioEn && video.mediaInfo && +video.mediaInfo.format.duration > 0) {
            var dur = +video.mediaInfo.format.duration;
            var partsCount = Math.ceil(dur / 600);
            var promises: Promise<{}>[] = [];
            var parts = [];
            var offset = (audioEn.videoStream && +audioEn.videoStream.start_time) || 0;

            let s = `ffmpeg -loglevel error -y -i ${shellArgEscape(
                video.fileName
            )} -itsoffset ${offset} -i ${shellArgEscape(audioEn.fileName)} `;
            for (let i = 0; i < partsCount; i++) {
                var file = new MediaFile(`${dir}${createdFilesPrefix}video_${i}.mp4`);
                parts.push(file);
                s += ` -map 0:0 -map 1:0 -ss ${i * 600} -t ${600} -metadata:s:v:0 rotate=90 -c copy ${shellArgEscape(
                    file.fileName
                )}`;
            }
            await exec(s);
            movieData.videoEnParts = parts;
        } else {
            throw new Error('video or audio not found or not recognized duration');
        }
    }

    async uploadVideoToYoutube() {
        this.log('uploadVideoToYoutube');
        var { movieData, movieData: { id, allFiles, videoEn, videoEnParts, dir } } = this;
        var promises = [];
        for (let i = 0; i < videoEnParts.length; i++) {
            var part = videoEnParts[i];
            promises.push(this.uploadVideoPartToYoutube(i, part));
        }
        await Promise.all(promises);
    }

    async uploadVideoPartToYoutube(partIdx: number, part: MediaFile, attempt = 1) {
        var { movieData, movieData: { id, allFiles, videoEn, videoEnParts, dir } } = this;
        this.log('uploadVideoPartToYoutube', part.fileName);
        try {
            var res = await this.youtube.upload('FooBar', fs.createReadStream(part.fileName));
            await query('INSERT INTO youtubeVideos (downloadId, ytId, part, createdAt) VALUES (?, ?, ?, NOW())', [
                id,
                res.id,
                partIdx,
            ]);
        } catch (err) {
            if (attempt <= 3) {
                this.log(`Upload error, try again: ${partIdx}\n` + err.stack);
                await this.uploadVideoPartToYoutube(partIdx, part, attempt + 1);
            } else {
                this.log(`Upload error: ${partIdx}\n` + err.stack);
            }
        }
        this.log('uploadVideoPartToYoutube done', part.fileName);
    }

    async uploadFileToGDrive(folderId: string, file: MediaFile) {
        this.log('uploadFileToGDrive', file.fileName);
        await this.drive.uploadFile(folderId, path.basename(file.fileName), fs.createReadStream(file.fileName));
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

    async removeAllStreamFiles() {
        this.log('removeAllStreamFiles');
        var { movieData: { allFiles } } = this;
        for (var i = 0; i < allFiles.length; i++) {
            var file = allFiles[i];
            if (file.videoStream !== void 0) {
                this.log('removeFile', file.fileName);
                try {
                    fs.unlinkSync(file.fileName);
                } catch (err) {
                    this.log(err.stack);
                }
            }
        }
    }

    async removeTorrent() {
        this.log('removeTorrent');
        // await this.torrentWorker.remove(this.movieData.torrent!);
    }

    async save(status: DownloadStatus) {
        var info = JSON.stringify(this.movieData, null, 2);
        await query('UPDATE downloads SET endedAt = NOW(), info = ?, status = ? WHERE id = ?', [
            info,
            status,
            this.movieData.id,
        ]);
    }

    log(type: string, fileName?: string) {
        var s = type + (fileName ? ': ' + fileName : '');
        this.movieData.logs.push(s);
        console.log(s);
    }
}

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
    var youtube = new Youtube(configDir);
    await youtube.auth();
    var torrentWorker = new TorrentWorker({ torrentDownloadLimit: 1 });
    // await drive.auth.authorize();
    var list = await query<MovieDownload[]>(
        'SELECT d.id, rt2.title, rt2.hash FROM downloads d LEFT JOIN rt2 ON rt2.id = rtId WHERE d.id IN (17,18,19,20)'
    );
    var promises: Promise<{}>[] = [];
    for (var i = 0; i < list.length; i++) {
        var row = list[i];
        var worker = new Worker(row.id, row.hash, torrentWorker, youtube);
        await worker.doWork();
        // promises.push(worker.doWork());
    }
    await Promise.all(promises);
}

main().catch(err => (err instanceof Error ? console.error('----------------------------------\n' + err.stack) : err));
