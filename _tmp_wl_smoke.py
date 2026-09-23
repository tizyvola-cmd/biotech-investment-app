import premium_waitlist as p
r=p.list_premium_waitlist()
print('ok', r.get('ok'), 'count', r.get('count'))

