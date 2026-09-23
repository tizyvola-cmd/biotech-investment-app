from daily_news_desk import (
    _body_matches_headline,
    _fetch_url_text_direct,
    _slugify_news_headline,
)

title = "Biogen (BIIB) Wins China Approval For At Home Weekly Alzheimer's Treatment - simplywall.st"
print("slug", _slugify_news_headline(title))
for u in [
    "https://simplywall.st/stocks/us/pharmaceuticals-biotech/nasdaq-biib/biogen/news/biogen-biib-wins-china-approval-for-at-home-weekly-alzheimer-s-treatment",
    "https://simplywall.st/stocks/us/pharmaceuticals-biotech/nasdaq-biib/biogen/news/biogen-biib-wins-china-approval-for-at-home-weekly-alzheimers-treatment",
    "https://simplywall.st/stocks/us/pharmaceuticals-biotech/nasdaq-biib/biogen/news/biogen-biib-wins-china-approval-for-at-home-weekly-alzheimer",
]:
    text, err = _fetch_url_text_direct(u)
    print(err, len(text or ""), u.split("/news/")[-1][:60], "match", _body_matches_headline(title, text or ""))
