import { readFileSync } from "fs";

var env = process.env.NODE_ENV || 'development';
export var config: Config;
try {
    config = JSON.parse(readFileSync(__dirname + '/config/' + env + '.json', 'utf8'));
} catch (e) {
    config = {} as Config;
    console.error(e);
}

interface Config {
    db: {
        host: string;
        user: string;
        database: string;
        password: string;
    };
    mail: {
        from: string;
        admin: string;
        options: {
            host: string,
            port: number,
            secure: boolean,
            auth: {
                user: string,
                pass: string
            }
        }
    }
}