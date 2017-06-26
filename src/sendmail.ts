import * as nodemailer from 'nodemailer';
import { config } from "./config";
let transporter = nodemailer.createTransport(config.mail.options);

export function sendMailToAdmin(subject: string, html: string) {
    return new Promise((resolve, reject) => {
        transporter.sendMail({
            from: config.mail.from,
            to: config.mail.admin,
            subject,
            html
        }, (error, info) => {
            if (error) return reject(error);
            resolve(info);
        });
    });
}


sendMailToAdmin('Wow!', "It's working!<br>Wow").catch(e => console.error(e));