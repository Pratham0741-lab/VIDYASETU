from app.services.consistency_service import compare_name_pair
pairs = [
 ("Anita Lakra","Anita Lakra"), ("Anita Lakra","Sunita Munda"), ("Anita Lakra District Ranchi","Sunita Munda"),
 ("Anita Lakra Annual Family Income Rs","Sunita Munda"), ("Anita Lakra","Anita Lakra Percentage"),
 ("Anita Lakra District Ranchi","Anita Lakra Category Scheduled Tribe"), ("Anita Lakra","Anita Lakra District Ranchi"),
 ("Sunita Munda","Sunita Hansda"), ("Meena Munda","Meena Hansda"), ("Ravi Munda","R. Munda"), ("Anita Lakra","Anita Lakda"),
 ("Anita Lakra","Anlta Lakra"), ("Kavya Oraon","Kavya Oraom"), ("Ram Kumar","Ramkumar"), ("Ram Kumar","R. Kumar"),
 ("Amit Kumar Shinde","Amit Shinde"), ("Rahul Singh","Rohit Sharma"), ("Amit Kumar","Sunil Kumar"),
 ("Shreya Sharma","Shreya Shrama"), ("Laxmi Devi","Lakshmi Devi"), ("Vikas Patel","Bikash Patel"),
 ("Ram Kumar Singh","Ram Kumar Verma"), ("Priya Tudu","Priya Tuddu"), ("Suresh Oraon","Naresh Oraon"),
]
for a,b in pairs:
    s,t = compare_name_pair(a,b); print(f"{a:38s} | {b:38s} | {s:.2f} {t}")
