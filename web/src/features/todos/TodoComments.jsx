import { useEffect, useRef, useState } from 'react';

const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
// 「刚刚」「5 分钟前」「3 小时前」，更早的写日期
function ago(at) {
  const s = (Date.now() - at) / 1000;
  if (s < 60) return '刚刚';
  if (s < 3600) return Math.floor(s / 60) + ' 分钟前';
  if (s < 86400) return Math.floor(s / 3600) + ' 小时前';
  return new Date(at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// 一条待办下面的评论：一条评论一串回复（回复别人的回复也进这一串，写着「回复 @谁」）。
// 谁登录了都能评论、回复；只能删自己的。act 和待办的其它操作是同一个（没登录先登录）。
export default function TodoComments({ t, me, busy, act }) {
  const [text, setText] = useState('');
  const [replying, setReplying] = useState(null); // { id, name }
  const box = useRef(null);
  const comments = t.comments || [];
  const threads = comments.filter(c => !c.replyTo).map(c => ({ c, replies: comments.filter(r => r.replyTo === c.id) }));

  useEffect(() => { if (replying) box.current?.focus(); }, [replying]);
  async function send() {
    const body = text.trim();
    if (!body) return;
    if (await act('/api/todos/comment', { id: t.id, text: body, ...(replying ? { replyTo: replying.id } : {}) })) { setText(''); setReplying(null); }
  }
  const remove = c => act('/api/todos/comment-delete', { id: t.id, commentId: c.id }, { confirmComment: true });

  const one = (c, reply) => (
    <div key={c.id} className={'tc-comment' + (reply ? ' reply' : '')}>
      {c.deleted ? <span className="tc-deleted">这条评论删掉了</span> : <>
        <span className="tc-avatar" aria-hidden="true">{Array.from(c.by)[0]?.toUpperCase()}</span>
        <div className="min-w-0 flex-1">
          <div className="tc-head"><b>{same(c.by, me) ? '我' : c.by}</b>{reply && c.replyToName && <span className="tc-to">回复 @{same(c.replyToName, me) ? '我' : c.replyToName}</span>}<span className="tc-at">{ago(c.at)}</span></div>
          <div className="tc-text">{c.text}</div>
          <div className="tc-acts">
            <button onClick={() => setReplying({ id: c.id, name: c.by })}>回复</button>
            {same(c.by, me) && <button onClick={() => remove(c)}>删除</button>}
          </div>
        </div>
      </>}
    </div>
  );

  return (
    <div className="tc-box">
      {threads.length > 0 && (
        <div className="tc-list">
          {threads.map(({ c, replies }) => (
            <div key={c.id} className="tc-thread">
              {one(c, false)}
              {replies.map(r => one(r, true))}
            </div>
          ))}
        </div>
      )}
      <div className="tc-write">
        {replying && <div className="tc-replying">回复 @{same(replying.name, me) ? '我' : replying.name}<button onClick={() => setReplying(null)} aria-label="不回复了">✕</button></div>}
        <div className="flex gap-2 items-end">
          <textarea ref={box} rows={1} maxLength={500} value={text} onChange={e => setText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }}
            placeholder={replying ? '写回复…' : comments.length ? '说点什么…' : '第一条评论：问问进度、补充信息…'} className="tc-input" />
          <button className="td-primary small" disabled={busy || !text.trim()} onClick={send}>发送</button>
        </div>
      </div>
    </div>
  );
}
