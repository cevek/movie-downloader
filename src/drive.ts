
import { configDir } from "./config";

var fs = require('fs');
var readline = require('readline');
var google = require('googleapis');
var googleAuth = require('google-auth-library');

var SCOPES = ['https://www.googleapis.com/auth/drive'];
var CLIENT_SECRET_PATH = configDir + 'client_secret.json';
var TOKEN_PATH = configDir + 'drive.json';

export class GoogleAuth {
  oauth2Client: any;
  async authorize() {
    var credentials = JSON.parse(fs.readFileSync(CLIENT_SECRET_PATH, 'utf8'));
    var clientSecret = credentials.installed.client_secret;
    var clientId = credentials.installed.client_id;
    var redirectUrl = credentials.installed.redirect_uris[0];
    var auth = new googleAuth();
    var oauth2Client = new auth.OAuth2(clientId, clientSecret, redirectUrl);

    try {
      var token = fs.readFileSync(TOKEN_PATH, 'utf8');
      oauth2Client.credentials = JSON.parse(token);
      this.oauth2Client = oauth2Client;
    } catch (e) {
      await this.getNewToken();
    }
  }

  protected getNewToken() {
    return new Promise((resolve, reject) => {
      var authUrl = this.oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: SCOPES
      });
      console.log('Authorize this app by visiting this url: ', authUrl);
      var rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });
      rl.question('Enter the code from that page here: ', (code: string) => {
        rl.close();
        this.oauth2Client.getToken(code, (err: Error, token: {}) => {
          if (err) return reject(err);
          this.oauth2Client.credentials = token;
          fs.writeFileSync(TOKEN_PATH, JSON.stringify(token));
          resolve(token);
        });
      });
    });
  }
}

export class Drive {
  auth = new GoogleAuth();

  protected action<T>(group: string, action: string, params: {}) {
    return new Promise<T>((resolve, reject) => {
      var drive = google.drive('v3');
      drive[group][action](Object.assign({ auth: this.auth.oauth2Client }, params), (err: Error, res: T) => {
        if (err) return reject(err);
        resolve(res);
      });
    });
  }

  list() {
    return this.action('files', 'list', {});
  }

  createFolder(name: string) {
    var fileMetadata = {
      'name': name,
      'mimeType': 'application/vnd.google-apps.folder'
    };
    return this.action<{id: string}>('files', 'create', {
      resource: fileMetadata,
      fields: 'id'
    });
  }

  uploadFile(folderId: string, name: string, body: any) {
    var fileMetadata = {
      'name': name,
      parents: [folderId]
    };
    var media = {
      // mimeType: 'image/jpeg',
      body: body
    };
    return this.action('files', 'create', {
      resource: fileMetadata,
      media: media,
      fields: 'id'
    });
  }
}


var drive = new Drive();
drive.auth.authorize();
// drive.createFolder('foo').catch(err => console.error(err));
drive.list().then(files => console.log(files)).catch(err => console.error(err));
// listFiles(oauth2Client).then(v => console.log(v))
// createFolder('movies').then(v => console.log(v)).catch(err => console.error(err))
// uploadFile('0B8kdvUt14xcqeDJmZ2xtRllFaW8', 'foo.txt', fs.createReadStream(__dirname + '/../category_2.csv')).then(v => console.log(v)).catch(err => console.error(err))


