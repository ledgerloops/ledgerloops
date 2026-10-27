use super::*;
pub async fn prepare(source: &Db, fixture: &Json, out: &Path) -> Result<Json> {
    let (owner, drive) = source.setup("Synthetic benchmark owner").await?;
    fs::write(out.join("temporary-owner.secret"), owner.build_secret()?)?;
    let mut properties = BTreeMap::<String,String>::new();
    let mut types = BTreeMap::<String,String>::new();
    for collection in ["issues", "notes"] {
        for record in fixture[collection].as_array().unwrap() {
            for (key,value) in record.as_object().unwrap() {
                let ty = match key.as_str() {
                    "created_at"|"updated_at"|"closed_at" => urls::TIMESTAMP,
                    "body" => urls::MARKDOWN,
                    "url" => urls::URI,
                    _ if value.is_boolean() => urls::BOOLEAN,
                    _ if value.is_i64() => urls::INTEGER,
                    _ if value.is_string() => urls::STRING,
                    _ => urls::JSON,
                };
                // 'labels' is JSON in both classes, with differing inner types.
                types.insert(key.clone(),ty.into());
            }
        }
    }
    properties.insert("title".into(),urls::NAME.into());
    for (key,ty) in &types {
        if key == "title" {continue}
        let shortname = key.replace('_',"-");
        let id = source.create_resource(urls::PROPERTY, &drive, key, Some(vec![
            (urls::SHORTNAME,Value::Slug(shortname)),
            (urls::DESCRIPTION,Value::Markdown(format!("Synthetic source field {key}"))),
            (urls::DATATYPE_PROP,Value::AtomicUrl(ty.as_str().into())),
        ])).await?;
        properties.insert(key.clone(),pure(&id));
    }
    let mut classes = BTreeMap::<String,String>::new();
    let mut tables = BTreeMap::<String,String>::new();
    let mut folders = BTreeMap::<String,String>::new();
    let mut records = BTreeMap::<String,String>::new();
    for collection in ["issues", "notes"] {
        let fields = fixture[collection][0].as_object().unwrap();
        let columns: Vec<_> = fields.keys().map(|k|properties[k].as_str().into()).collect();
        let class = source.create_resource(urls::CLASS,&drive,collection,Some(vec![
            (urls::SHORTNAME,Value::Slug(collection.into())),
            (urls::DESCRIPTION,Value::Markdown(format!("Synthetic {collection}"))),
            (urls::RECOMMENDS,Value::ResourceArray(columns.clone())),
        ])).await?;
        let folder = source.create_resource(urls::FOLDER,&drive,&format!("{collection} account"),None).await?;
        let table = source.create_resource(urls::TABLE,&folder,collection,Some(vec![
            (urls::CLASSTYPE_PROP,Value::AtomicUrl(class.as_str().into())),
            (urls::PROPERTIES,Value::ResourceArray(columns)),
        ])).await?;
        for record in fixture[collection].as_array().unwrap() {
            let mut props = Vec::new();
            for (key,value) in record.as_object().unwrap() {
                if value.is_null() && key == "closed_at" {continue}
                let native = match types[key].as_str() {
                    urls::TIMESTAMP => Value::Timestamp(match value.as_str().unwrap() {
                        "2026-01-01T12:00:00Z" => 1767268800000,
                        "2026-01-02T12:00:00Z" => 1767355200000,
                        _ => return Err("Unexpected fixture timestamp".into()),
                    }),
                    urls::MARKDOWN => Value::Markdown(value.as_str().unwrap().into()),
                    urls::URI => Value::Uri(value.as_str().unwrap().into()),
                    urls::STRING => Value::String(value.as_str().unwrap().into()),
                    urls::INTEGER => Value::Integer(value.as_i64().unwrap()),
                    urls::BOOLEAN => Value::Boolean(value.as_bool().unwrap()),
                    _ => Value::Json(value.clone()),
                };
                props.push((properties[key].as_str(),native));
            }
            let subject = source.create_resource(&class,&table,record["title"].as_str().unwrap(),Some(props)).await?;
            records.insert(record["id"].as_str().unwrap().into(),pure(&subject));
        }
        classes.insert(collection.into(),pure(&class));
        tables.insert(collection.into(),pure(&table));
        folders.insert(collection.into(),pure(&folder));
    }
    source.flush()?;
    let config = json!({"drive":pure(&drive),"ownerPublicKey":owner.public_key,
        "properties":properties,"types":types,"records":records,"classes":classes,
        "tables":tables,"folders":folders,"payloadResources":132,"customSchemaResources":types.len()-1+2,
        "containerResources":5,"fixtureSha256":"9b8f0b8e52345b95d0bd3434d125ef2dc1a688ad537c0c3a1ccc8348981a101a"});
    fs::write(out.join("model-h-config.json"),serde_json::to_vec_pretty(&config)?)?;
    Ok(config)
}
pub async fn reconstruct(db:&Db,config:&Json,fixture:&Json)->Result<Json> {
    let mut result=json!({"issues":[],"notes":[]});
    for collection in ["issues","notes"] {
        for expected in fixture[collection].as_array().unwrap() {
            let id=expected["id"].as_str().unwrap();
            let subject=config["records"][id].as_str().unwrap();
            let resource=db.get_resource(&subject.into()).await?;
            let ad:Json=serde_json::from_str(&resource.to_json_ad(None)?)?;
            let mut record=serde_json::Map::new();
            for key in expected.as_object().unwrap().keys() {
                let property=config["properties"][key].as_str().unwrap();
                let mut value=ad.get(property).cloned().unwrap_or(Json::Null);
                if !value.is_null() && config["types"][key]==urls::TIMESTAMP {
                    value=json!(match value.as_i64().ok_or("Timestamp lost numeric type")? {
                        1767268800000=>"2026-01-01T12:00:00Z",1767355200000=>"2026-01-02T12:00:00Z",
                        _=>return Err("Timestamp changed".into()),
                    });
                }
                record.insert(key.clone(),value);
            }
            result[collection].as_array_mut().unwrap().push(Json::Object(record));
        }
    }
    Ok(result)
}
