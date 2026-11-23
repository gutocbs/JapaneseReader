CREATE TABLE furigana_exclusions (
    lemma TEXT NOT NULL,
    dictionary_reading TEXT NOT NULL,
    PRIMARY KEY (lemma, dictionary_reading)
);
