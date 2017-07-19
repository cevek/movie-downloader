// import { configDir } from "./config";

var fs = require('fs');
var readline = require('readline');
var google = require('googleapis');
var googleAuth = require('google-auth-library');

// import google from 'googleapis';

// var SCOPES = ['https://www.googleapis.com/auth/drive'];

export class GoogleAuth {
    oauth2Client: any;
    TOKEN_PATH = this.configDir + 'drive.json';
    constructor(public scopes: string[], public configDir: string) {}
    async authorize() {
        var CLIENT_SECRET_PATH = this.configDir + 'client_secret.json';
        var credentials = JSON.parse(fs.readFileSync(CLIENT_SECRET_PATH, 'utf8'));
        var clientSecret = credentials.installed.client_secret;
        var clientId = credentials.installed.client_id;
        var redirectUrl = credentials.installed.redirect_uris[0];
        var auth = new googleAuth();
        this.oauth2Client = new auth.OAuth2(clientId, clientSecret, redirectUrl);

        try {
            var token = fs.readFileSync(this.TOKEN_PATH, 'utf8');
            this.oauth2Client.credentials = JSON.parse(token);
            this.refreshAccessToken();
        } catch (e) {
            await this.getNewToken();
        }
    }

    protected refreshAccessToken() {
        return new Promise((resolve, reject) => {
            this.oauth2Client.refreshAccessToken((err: Error, tokens: {}) => {
                if (err) return reject(err);
                resolve(tokens);
            });
        });
    }

    protected getNewToken() {
        return new Promise((resolve, reject) => {
            var authUrl = this.oauth2Client.generateAuthUrl({
                access_type: 'offline',
                scope: this.scopes,
            });
            console.log('Authorize this app by visiting this url: ', authUrl);
            var rl = readline.createInterface({
                input: process.stdin,
                output: process.stdout,
            });
            rl.question('Enter the code from that page here: ', (code: string) => {
                rl.close();
                this.oauth2Client.getToken(code, (err: Error, token: {}) => {
                    if (err) return reject(err);
                    this.oauth2Client.credentials = token;
                    fs.writeFileSync(this.TOKEN_PATH, JSON.stringify(token));
                    resolve(token);
                });
            });
        });
    }
}

interface GoogleOptions {
    serviceName: string;
    scopes: string[];
    configDir: string;
}

class Google {
    auth = new GoogleAuth(this.options.scopes, this.options.configDir);

    constructor(private options: GoogleOptions) {}

    action<T>(group: string, action: string, params: {}) {
        return new Promise<T>((resolve, reject) => {
            var drive = google[this.options.serviceName]('v3');
            drive[group][action](Object.assign({ auth: this.auth.oauth2Client }, params), (err: Error, res: T) => {
                if (err) return reject(err);
                resolve(res);
            });
        });
    }
}

export class Drive {
    constructor(private configDir: string) {}
    protected google = new Google({
        serviceName: 'drive',
        scopes: ['https://www.googleapis.com/auth/drive'],
        configDir: this.configDir,
    });

    auth() {
        return this.google.auth.authorize();
    }

    list() {
        return this.google.action('files', 'list', {});
    }

    createFolder(name: string) {
        var fileMetadata = {
            name: name,
            mimeType: 'application/vnd.google-apps.folder',
        };
        return this.google.action<{ id: string }>('files', 'create', {
            resource: fileMetadata,
            fields: 'id',
        });
    }

    uploadFile(folderId: string, name: string, body: any) {
        var fileMetadata = {
            name: name,
            parents: [folderId],
        };
        var media = {
            // mimeType: 'image/jpeg',
            body: body,
        };
        return this.google.action('files', 'create', {
            resource: fileMetadata,
            media: media,
            fields: 'id',
        });
    }
}

export class Youtube {
    constructor(private configDir: string) {}
    protected google = new Google({
        serviceName: 'youtube',
        scopes: ['https://www.googleapis.com/auth/youtube', 'https://www.googleapis.com/auth/youtube.force-ssl'],
        configDir: this.configDir,
    });
    auth() {
        return this.google.auth.authorize();
    }

    search(search: {}) {
        return this.google.action<any>('search', 'list', search);
    }

    videosList(params: {}) {
        return this.google.action<any>('videos', 'list', params);
    }

    captionList(params: {}) {
        return this.google.action<any>('captions', 'list', params);
    }
    captionDownload(id: string) {
        return this.google.action<any>('captions', 'download', { id });
    }

    upload(title: string, body: any) {
        return this.google.action<{ id: string }>('videos', 'insert', {
            resource: {
                snippet: {
                    title: title,
                    privacyStatus: 'private',
                },
            },
            media: {
                // mimeType: 'image/jpeg',
                body: body,
            },
            part: 'id,snippet',
        });
    }
}

// var drive = new Drive();
// drive.auth.authorize();
// drive.createFolder('foo').catch(err => console.error(err));
// drive.list().then(files => console.log(files)).catch(err => console.error(err));
// listFiles(oauth2Client).then(v => console.log(v))
// createFolder('movies').then(v => console.log(v)).catch(err => console.error(err))
// uploadFile('0B8kdvUt14xcqeDJmZ2xtRllFaW8', 'foo.txt', fs.createReadStream(__dirname + '/../category_2.csv')).then(v => console.log(v)).catch(err => console.error(err))
