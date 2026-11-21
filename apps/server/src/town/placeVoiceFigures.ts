// 語音頻道裡的成員要站在房間的哪裡。純函式：同樣的輸入一定得到同樣的站位，成員不會在畫面上亂跳。
// 伺服器和前端都會讀它的型別；不能 import 任何 Node 專用的東西。

import type { ChannelRoom } from "./layoutTown.js";

/** 站位需要的成員欄位。 */
export type VoiceSeat = { userId: string; channelId: string };

const SLOT = 16; // 站位間距（像素）
const TOP_GAP = 24; // 房間上方留給房名的空間

/**
 * 把每位成員放進他所在語音頻道的房間，房間裡依 userId 排隊站好。
 * 頻道不在地圖上（例如私人頻道）的成員不放。
 * ponytail: 房間站滿後（目前 6×2=12 人）從頭再排一輪、往右下偏 4px 疊上去；人很多的頻道再改成顯示「+N」。
 */
export function placeVoiceFigures<T extends VoiceSeat>(rooms: ChannelRoom[], members: T[]): (T & { x: number; y: number })[] {
    const roomById = new Map(rooms.map((room) => [room.id, room]));
    const byRoom = new Map<string, T[]>();
    for (const member of members) {
        if (!roomById.has(member.channelId)) continue;
        if (!byRoom.has(member.channelId)) byRoom.set(member.channelId, []);
        byRoom.get(member.channelId)!.push(member);
    }

    const placed: (T & { x: number; y: number })[] = [];
    for (const [channelId, list] of byRoom) {
        const { rect } = roomById.get(channelId)!;
        const cols = Math.max(1, Math.floor(rect.width / SLOT));
        const rows = Math.max(1, Math.floor((rect.height - TOP_GAP) / SLOT));
        const capacity = cols * rows;
        list.sort((a, b) => a.userId.localeCompare(b.userId));
        list.forEach((member, i) => {
            const slot = i % capacity;
            const round = Math.floor(i / capacity);
            placed.push({
                ...member,
                x: rect.x + SLOT / 2 + (slot % cols) * SLOT + round * 4,
                y: rect.y + TOP_GAP + Math.floor(slot / cols) * SLOT + round * 4,
            });
        });
    }
    return placed;
}
