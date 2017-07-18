import { readFileSync } from 'fs';

import * as mysql from 'mysql';
import { config } from "./config";

const connection = mysql.createConnection(config.db);
connection.connect();

export function query<T>(sql: string, args?: (number | boolean | string | Date | null)[]) {
    return new Promise<T>((resolve, reject) => {
        var q:any = connection.query(sql, args, (error: any, results: T) => {
            if (error) return reject(new Error(error.message + '\n' + q.sql));
            return resolve(results);
        });
    });
}