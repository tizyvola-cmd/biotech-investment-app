from daily_news_desk import _body_matches_headline, _title_token_set, _HEADLINE_STORY_CUES

title = "Biogen (BIIB) Wins China Approval For At Home Weekly Alzheimer's Treatment - simplywall.st"
body = (
    "Up to 20% of children with Dravet syndrome die before adulthood. A long-term study of an experimental drug "
    "showed fewer severe seizures.. Stoke Therapeutics and Biogen Present Long-Term Clinical Data that Support "
    "the Disease-Modifying Potential of Zorevunersen, an Investigational"
)
print("tokens", sorted(_title_token_set(title)))
low = body.lower()
toks = _title_token_set(title) - {"beta","bionics","medical","pharma","pharmaceuticals","therapeutics","biosciences","company","shares","stock"}
hits = [t for t in toks if t in low]
print("hits", hits, "need", 3 if len(toks)>=6 else 2)
print("match", _body_matches_headline(title, body))
for title_rx, body_rx in _HEADLINE_STORY_CUES:
    if title_rx.search(title):
        print("cue title", title_rx.pattern, "body?", bool(body_rx.search(body)))
