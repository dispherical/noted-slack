require('dotenv').config()
const { App } = require('@slack/bolt');
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const crypto = require("node:crypto")

const app = new App({
    token: process.env.SLACK_BOT_TOKEN,
    socketMode: true,
    appToken: process.env.SLACK_APP_TOKEN,
    signingSecret: process.env.SLACK_SIGNING_SECRET,
});
app.view('write_note', async ({ view, ack, body, respond }) => {
    await ack()

    const submittedValues = view.state.values
    let note;

    try {
        var json = JSON.parse(view.private_metadata)
    } catch (e) {
        return respond("Something bad happened. Likely more than one instance is running.")
    }
    const { channelId, refrenceId } = json

    for (let key in submittedValues) {
        if (submittedValues[key]['plain_text_input-action']) note = submittedValues[key]['plain_text_input-action'].value
    }
    if (!note) return respond("Please provide a note.")
    const record = await prisma.note.findFirst({
        where: {
            id: refrenceId
        }
    })
    if (!record) {
        await prisma.note.create({
            data: {
                channelId,
                refrenceId,
                id: crypto.randomUUID()
            }
        })
    }
    const res = await (await fetch(`${process.env.BASE_URL}/api/notes?${new URLSearchParams({
        postId: refrenceId,
        userId: body.user.id,
        text: note
    })}`, {
        method: "POST"
    })).json()
    await app.client.chat.postMessage({
        channel: process.env.REVIEWERS_CHANNEL,
        blocks: [
            {
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": `New community note submitted for https://hackclub.slack.com/archives/${channelId}/p${refrenceId.toString().replace(".", "")}\n\n${note.split("\n").map(a => `> ${a}`).join("\n")}`
                }
            },
            {
                "type": "actions",
                "elements": [
                    {
                        "type": "button",
                        "text": {
                            "type": "plain_text",
                            "text": "Helpful",
                            "emoji": true
                        },
                        "value": res.id,
                        "action_id": "score_helpful"
                    },
                    {
                        "type": "button",
                        "text": {
                            "type": "plain_text",
                            "text": "Somewhat Helpful",
                            "emoji": true
                        },
                        "value": res.id,
                        "action_id": "score_somewhat_helpful"
                    },
                    {
                        "type": "button",
                        "text": {
                            "type": "plain_text",
                            "text": "Not Helpful",
                            "emoji": true
                        },
                        "value": res.id,
                        "action_id": "score_not_helpful"
                    }
                ]
            }
        ],
        text: `Note requested.`
    })

})
app.action("score_helpful", async ({ ack, respond, say, body, action }) => {
    await ack()
    console.log(action.value)
    if (!action.value) return
    const b = await (await fetch(`${process.env.BASE_URL}/api/votes?${new URLSearchParams({
        noteId: action.value,
        userId: body.user.id,
        score: "1",
        forceValid: true
    })}`, {
        method: "POST"
    })).json()
    await app.client.chat.postEphemeral({
        user: body.user.id,
        channel: process.env.REVIEWERS_CHANNEL,
        text: "✅ Marked as helpful."
    })
})
app.action("score_somewhat_helpful", async ({ ack, respond, say, body, action }) => {
    await ack()
    console.log(action.value)
    if (!action.value) return
    const b = await (await fetch(`${process.env.BASE_URL}/api/votes?${new URLSearchParams({
        noteId: action.value,
        userId: body.user.id,
        score: "0.5",
        forceValid: true
    })}`, {
        method: "POST"
    })).json()

    await app.client.chat.postEphemeral({
        user: body.user.id,
        channel: process.env.REVIEWERS_CHANNEL,
        text: "✅ Marked as somewhat helpful."
    })
})

app.action("score_not_helpful", async ({ ack, respond, say, body, action }) => {
    await ack()
    console.log(action.value)
    if (!action.value) return
    const b = await (await fetch(`${process.env.BASE_URL}/api/votes?${new URLSearchParams({
        noteId: action.value,
        userId: body.user.id,
        score: "0",
        forceValid: true
    })}`, {
        method: "POST"
    })).json()

    await app.client.chat.postEphemeral({
        user: body.user.id,
        channel: process.env.REVIEWERS_CHANNEL,
        text: "✅ Marked as not helpful."
    })
})
app.shortcut('write_note', async ({ ack, body, say, client, respond }) => {
    await ack();
    if (process.env.SLACK_WHITELIST) {
        if (!process.env.SLACK_WHITELIST.includes(body.channel.id)) return await respond("Noted isn't supported in this channel.")
    }
    const modal = require("./modals/writeNote.json");

    return await client.views.open({
        trigger_id: body.trigger_id,
        view: {
            ...modal, callback_id: "write_note", private_metadata: JSON.stringify({
                channelId: body.channel.id,
                refrenceId: body.message_ts,
            })
        }
    })
})
app.shortcut('request_note', async ({ ack, body, say, client, respond }) => {
    await ack()
    if (process.env.SLACK_WHITELIST) {
        if (!process.env.SLACK_WHITELIST.includes(body.channel.id)) return await respond("Noted isn't supported in this channel.")
    }
    const record = await prisma.request.findFirst({
        where: {
            id: body.message_ts
        }
    })
    if (record) return respond("A request has already been filed.")
    await prisma.request.create({
        data: {
            id: body.message_ts,
            requestedBy: body.user.id
        }
    })
    await app.client.chat.postMessage({
        channel: process.env.REVIEWERS_CHANNEL,
        blocks: [
            {
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": `:sticky-note: Note requested.\nhttps://hackclub.slack.com/archives/${body.channel.id}/p${body.message_ts.toString().replace(".", "")}`
                }
            },
            {
                "type": "actions",
                "elements": [
                    {
                        "type": "button",
                        "text": {
                            "type": "plain_text",
                            "text": "Write one",
                            "emoji": true
                        },
                        "value": JSON.stringify({
                            channelId: body.channel.id,
                            refrenceId: body.message_ts
                        }),
                        "action_id": "write_note"
                    }
                ]
            }
        ],
        text: `Note requested.`
    })
});
(async () => {
    await app.start();
    const notes = await prisma.note.findMany({
        where: {}
    })
    async function loop() {
        const ids = new Set()
        notes.forEach(note => ids.add(note.refrenceId))
        ids.forEach(async id => {
            const a = await (await fetch(`${process.env.BASE_URL}/api/getNotesForPost/${id}`, {
                method: "GET"
            })).json()
            const note = await prisma.note.findFirst({
                where: {
                    refrenceId: id
                }
            })
            if (!note) return
            const text = a.find(p => p.status == "Helpful")?.text
            if (note.noteMessageId && text) {
                await app.client.chat.update({
                    channel: note.channelId,
                    ts: note.noteMessageId,
                    text: `Readers added context <https://hackclub.slack.com/archives/${note.channelId}/p${note.refrenceId.toString().replace(".", "")}|to this message>:\n\n${text.split("\n").map(a => `> ${a}`).join("\n")}`,
                })
            } else if (note.noteMessageId && !text) {
                await app.client.chat.delete({
                    channel: note.channelId,
                    ts: note.noteMessageId,
                })
                await prisma.note.delete({
                    where: {
                        id: note.id
                    }
                })
            } else if (!text) {
                return
            } else {
                const pm = await app.client.chat.postMessage({
                    channel: note.channelId,
                    thread_ts: note.refrenceId,
                    text: `Readers added context <https://hackclub.slack.com/archives/${note.channelId}/p${note.refrenceId.toString().replace(".", "")}|to this message>:\n\n${text.split("\n").map(a => `> ${a}`).join("\n")}`,
                    unfurl_links: true,
                    unfurl_media: true
                })
                await prisma.note.update({
                    where: {
                        id: note.id
                    },
                    data: {
                        noteMessageId: pm.ts
                    }
                })
            }

        })

    }
    loop()
    setInterval(loop, 1000 * 60)
})();